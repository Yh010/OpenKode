import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolResult } from "../interface/Tool.js";

const ALLOWED_SCRIPTS = new Set(["test", "lint", "build", "format:check"]);
const LOCKFILES = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
] as const;
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 32_000;

export type PackageManager = "npm" | "pnpm" | "yarn";

export interface PackageManifest {
    packageManager?: unknown;
    scripts?: unknown;
}

type ManifestResult = { success: true; manifest: PackageManifest } | { success: false; result: ToolResult };
export type ManagerResult = { success: true; manager: PackageManager } | { success: false; result: ToolResult };

interface RunCommandToolOptions {
    timeoutMs?: number;
    maxOutputBytes?: number;
}

export class RunCommandTool implements Tool {
    readonly name = "RunCommandTool";
    readonly description = "Run one approved root package.json verification script without a shell.";

    constructor(
        private readonly projectRoot: string,
        private readonly options: RunCommandToolOptions = {},
    ) {}

    async execute(input: string): Promise<ToolResult> {
        const script = parseScript(input);
        if (!script) {
            return failure("INVALID_COMMAND", "Input must be JSON with one approved script name.");
        }

        const manifestResult = await readManifest(this.projectRoot);
        if (!manifestResult.success) {
            return manifestResult.result;
        }

        if (!hasScript(manifestResult.manifest, script)) {
            return failure("SCRIPT_NOT_FOUND", `The root package.json does not define the "${script}" script.`);
        }

        const managerResult = await detectPackageManager(this.projectRoot, manifestResult.manifest);
        if (!managerResult.success) {
            return managerResult.result;
        }

        return runScript(
            this.projectRoot,
            managerResult.manager,
            script,
            this.options.timeoutMs ?? COMMAND_TIMEOUT_MS,
            this.options.maxOutputBytes ?? MAX_OUTPUT_BYTES,
        );
    }
}

function parseScript(input: string): string | undefined {
    try {
        const value: unknown = JSON.parse(input);
        if (
            typeof value === "object" && value !== null && !Array.isArray(value)
            && "script" in value && typeof value.script === "string"
            && ALLOWED_SCRIPTS.has(value.script)
        ) {
            return value.script;
        }
    } catch {
        // Invalid JSON is handled by the caller.
    }
}

async function readManifest(projectRoot: string): Promise<ManifestResult> {
    try {
        const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
        const value: unknown = JSON.parse(raw);
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return { success: false, result: failure("INVALID_MANIFEST", "The root package.json must contain a JSON object.") };
        }
        return { success: true, manifest: value as PackageManifest };
    } catch (error) {
        if (nodeErrorCode(error) === "ENOENT") {
            return { success: false, result: failure("MANIFEST_NOT_FOUND", "No root package.json was found in this project.") };
        }
        if (error instanceof SyntaxError) {
            return { success: false, result: failure("INVALID_MANIFEST", "The root package.json is not valid JSON.") };
        }
        return { success: false, result: failure("INVALID_MANIFEST", `Could not read the root package.json: ${errorMessage(error)}`) };
    }
}

function hasScript(manifest: PackageManifest, script: string): boolean {
    if (typeof manifest.scripts !== "object" || manifest.scripts === null || Array.isArray(manifest.scripts)) {
        return false;
    }
    return script in manifest.scripts && typeof (manifest.scripts as Record<string, unknown>)[script] === "string";
}

export async function detectPackageManager(projectRoot: string, manifest: PackageManifest): Promise<ManagerResult> {
    const declared = managerFromDeclaration(manifest.packageManager);
    if (declared) {
        return { success: true, manager: declared };
    }
    if (typeof manifest.packageManager === "string") {
        return { success: false, result: failure("UNSUPPORTED_PACKAGE_MANAGER", `Unsupported package manager "${manifest.packageManager}".`) };
    }

    const managers = await Promise.all(LOCKFILES.map(async ([file, manager]) =>
        await fileExists(path.join(projectRoot, file)) ? manager : undefined,
    ));
    const detected = managers.filter((manager): manager is PackageManager => manager !== undefined);
    if (detected.length === 0) {
        return { success: false, result: failure("UNSUPPORTED_PROJECT", "No supported package-manager declaration or lockfile was found.") };
    }
    if (detected.length > 1) {
        return { success: false, result: failure("AMBIGUOUS_PACKAGE_MANAGER", "Multiple supported package-manager lockfiles were found.") };
    }
    return { success: true, manager: detected[0]! };
}

function managerFromDeclaration(value: unknown): PackageManager | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const manager = value.split("@", 1)[0];
    return manager === "npm" || manager === "pnpm" || manager === "yarn" ? manager : undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        return (await stat(filePath)).isFile();
    } catch {
        return false;
    }
}

async function runScript(
    projectRoot: string,
    manager: PackageManager,
    script: string,
    timeoutMs: number,
    maxOutputBytes: number,
): Promise<ToolResult> {
    const invocation = packageManagerInvocation(manager, script);
    return new Promise((resolve) => {
        let output = "";
        let timedOut = false;
        let settled = false;
        const child = spawn(invocation.executable, invocation.args, {
            cwd: projectRoot,
            shell: false,
            windowsHide: true,
        });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        const finish = (result: ToolResult) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(result);
            }
        };
        const append = (chunk: Buffer) => {
            const available = maxOutputBytes - Buffer.byteLength(output);
            if (available > 0) {
                output += chunk.subarray(0, available).toString("utf8");
            }
        };

        child.stdout.on("data", append);
        child.stderr.on("data", append);
        child.on("error", (error) => finish(failure("COMMAND_FAILED", `Could not start ${manager}: ${errorMessage(error)}`)));
        child.on("close", (exitCode) => {
            const summary = JSON.stringify({ manager, script, exitCode, timedOut, output });
            if (timedOut) {
                finish(failure("COMMAND_TIMED_OUT", summary));
                return;
            }
            if (exitCode !== 0) {
                finish(failure("COMMAND_FAILED", summary));
                return;
            }
            finish({ ok: true, output: summary });
        });
    });
}

function packageManagerInvocation(manager: PackageManager, script: string): { executable: string; args: string[] } {
    if (process.platform !== "win32") {
        return { executable: manager, args: ["run", script] };
    }

    const nodeModules = path.join(path.dirname(process.execPath), "node_modules");
    if (manager === "npm") {
        return {
            executable: process.execPath,
            args: [path.join(nodeModules, "npm", "bin", "npm-cli.js"), "run", script],
        };
    }

    return {
        executable: process.execPath,
        args: [path.join(nodeModules, "corepack", "dist", "corepack.js"), manager, "run", script],
    };
}

function failure(code: Extract<ToolResult, { ok: false }>["code"], message: string): ToolResult {
    return { ok: false, code, message };
}

function nodeErrorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
