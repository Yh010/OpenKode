import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolResult } from "../interface/Tool.js";
import { resolveProjectPath } from "../resolveProjectPath.js";

interface WriteInput {
    path: string;
    content: string;
}

export class WriteFileTool implements Tool {
    readonly name = "WriteFileTool";
    readonly description = "Create or replace a UTF-8 file inside the current project.";

    constructor(private readonly projectRoot: string) {}

    async execute(input: string): Promise<ToolResult> {
        const writeInput = parseWriteInput(input);
        if (!writeInput) {
            return failure("INVALID_INPUT", "Input must be JSON with string path and content fields.");
        }

        let filePath: string;
        try {
            filePath = resolveProjectPath(this.projectRoot, writeInput.path);
        } catch (error) {
            return failure("INVALID_PATH", errorMessage(error));
        }

        try {
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, writeInput.content, "utf8");
            return { ok: true, output: `Wrote "${writeInput.path}".` };
        } catch (error) {
            const code = nodeErrorCode(error);
            if (code === "EACCES" || code === "EPERM") {
                return failure("PERMISSION_DENIED", `Permission was denied while writing "${writeInput.path}".`);
            }

            return failure("WRITE_FAILED", `Could not write "${writeInput.path}": ${errorMessage(error)}`);
        }
    }
}

function parseWriteInput(input: string): WriteInput | undefined {
    try {
        const value: unknown = JSON.parse(input);
        if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            "path" in value &&
            "content" in value &&
            typeof value.path === "string" &&
            value.path.trim().length > 0 &&
            typeof value.content === "string"
        ) {
            return { path: value.path, content: value.content };
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function failure(code: Extract<ToolResult, { ok: false }>["code"], message: string): ToolResult {
    return { ok: false, code, message };
}

function nodeErrorCode(error: unknown): string | undefined {
    return typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
