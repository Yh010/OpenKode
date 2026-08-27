import { readFile, stat } from "node:fs/promises";
import { resolveProjectPath } from "../resolveProjectPath.js";
import type { Tool, ToolResult } from "../interface/Tool.js";

export class ReadFileTool implements Tool {
    readonly name = "ReadFileTool";
    readonly description = "Read the UTF-8 contents of a file inside the current project.";

    constructor(private readonly projectRoot: string) {}

    async execute(input: string): Promise<ToolResult> {
        let filePath: string;

        try {
            filePath = resolveProjectPath(this.projectRoot, input);
        } catch (error) {
            return failure("INVALID_PATH", errorMessage(error));
        }

        try {
            const fileInfo = await stat(filePath);
            if (!fileInfo.isFile()) {
                return failure("NOT_A_FILE", `"${input}" is not a file.`);
            }

            return { ok: true, output: await readFile(filePath, "utf8") };
        } catch (error) {
            const code = nodeErrorCode(error);

            if (code === "ENOENT") {
                return failure("NOT_FOUND", `"${input}" was not found.`);
            }

            if (code === "EACCES" || code === "EPERM") {
                return failure("PERMISSION_DENIED", `Permission was denied while reading "${input}".`);
            }

            return failure("READ_FAILED", `Could not read "${input}": ${errorMessage(error)}`);
        }
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
