import fg from "fast-glob";
import path from "node:path";
import type { Tool, ToolResult } from "../interface/Tool.js";

const MAX_MATCHES = 100;
const IGNORED_PATHS = ["**/node_modules/**", "**/.git/**", "**/dist/**"];

export class GlobTool implements Tool {
    readonly name = "GlobTool";
    readonly description = "Find project files that match one glob pattern.";

    constructor(private readonly projectRoot: string) {}

    async execute(input: string): Promise<ToolResult> {
        const pattern = parsePattern(input);
        if (!pattern) {
            return failure("INVALID_INPUT", "Input must be JSON with a non-empty string pattern field.");
        }

        const safetyError = validatePattern(pattern);
        if (safetyError) {
            return failure("INVALID_PATH", safetyError);
        }

        try {
            const matches = await fg(pattern, {
                cwd: this.projectRoot,
                onlyFiles: true,
                followSymbolicLinks: false,
                caseSensitiveMatch: false,
                ignore: IGNORED_PATHS,
            });
            const files = matches.sort().slice(0, MAX_MATCHES);

            if (files.length === 0) {
                return failure("NO_MATCHES", `No files matched pattern "${pattern}".`);
            }

            return { ok: true, output: JSON.stringify({ matches: files }) };
        } catch (error) {
            if (nodeErrorCode(error) === "EACCES" || nodeErrorCode(error) === "EPERM") {
                return failure("PERMISSION_DENIED", `Permission was denied while matching "${pattern}".`);
            }

            return failure("GLOB_FAILED", `Could not match "${pattern}": ${errorMessage(error)}`);
        }
    }
}

function parsePattern(input: string): string | undefined {
    try {
        const value: unknown = JSON.parse(input);
        if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            "pattern" in value &&
            typeof value.pattern === "string" &&
            value.pattern.trim().length > 0
        ) {
            return value.pattern;
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function validatePattern(pattern: string): string | undefined {
    if (pattern.includes("\0")) {
        return "Patterns cannot contain null characters.";
    }

    if (path.isAbsolute(pattern)) {
        return "Absolute patterns are not allowed.";
    }

    if (pattern.split(/[\\/]/).includes("..")) {
        return "Patterns must stay inside the current project.";
    }
}

function failure(code: Extract<ToolResult, { ok: false }> ["code"], message: string): ToolResult {
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
