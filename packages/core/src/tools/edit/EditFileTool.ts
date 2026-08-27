import { readFile, stat, writeFile } from "node:fs/promises";
import type { Tool, ToolResult } from "../interface/Tool.js";
import { resolveProjectPath } from "../resolveProjectPath.js";

interface EditInput {
    path: string;
    oldText: string;
    newText: string;
}

export class EditFileTool implements Tool {
    readonly name = "EditFileTool";
    readonly description = "Replace exactly one matching text block in a file inside the current project.";

    constructor(private readonly projectRoot: string) {}

    async execute(input: string): Promise<ToolResult> {
        const editInput = parseEditInput(input);
        if (!editInput) {
            return failure("INVALID_INPUT", "Input must be JSON with string path, oldText, and newText fields. oldText cannot be empty.");
        }

        let filePath: string;
        try {
            filePath = resolveProjectPath(this.projectRoot, editInput.path);
        } catch (error) {
            return failure("INVALID_PATH", errorMessage(error));
        }

        try {
            const fileInfo = await stat(filePath);
            if (!fileInfo.isFile()) {
                return failure("NOT_A_FILE", `"${editInput.path}" is not a file.`);
            }

            const currentContent = await readFile(filePath, "utf8");
            const firstMatch = currentContent.indexOf(editInput.oldText);
            if (firstMatch === -1) {
                return failure("TEXT_NOT_FOUND", `The requested text was not found in "${editInput.path}".`);
            }

            if (currentContent.indexOf(editInput.oldText, firstMatch + 1) !== -1) {
                return failure("TEXT_NOT_UNIQUE", `The requested text appears more than once in "${editInput.path}".`);
            }

            const updatedContent = currentContent.slice(0, firstMatch)
                + editInput.newText
                + currentContent.slice(firstMatch + editInput.oldText.length);
            await writeFile(filePath, updatedContent, "utf8");
            return { ok: true, output: `Edited "${editInput.path}".` };
        } catch (error) {
            const code = nodeErrorCode(error);
            if (code === "ENOENT") {
                return failure("NOT_FOUND", `"${editInput.path}" was not found.`);
            }

            if (code === "EACCES" || code === "EPERM") {
                return failure("PERMISSION_DENIED", `Permission was denied while editing "${editInput.path}".`);
            }

            return failure("EDIT_FAILED", `Could not edit "${editInput.path}": ${errorMessage(error)}`);
        }
    }
}

function parseEditInput(input: string): EditInput | undefined {
    try {
        const value: unknown = JSON.parse(input);
        if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            "path" in value &&
            "oldText" in value &&
            "newText" in value &&
            typeof value.path === "string" &&
            value.path.trim().length > 0 &&
            typeof value.oldText === "string" &&
            value.oldText.length > 0 &&
            typeof value.newText === "string"
        ) {
            return {
                path: value.path,
                oldText: value.oldText,
                newText: value.newText,
            };
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
