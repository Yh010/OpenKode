import { readFile, stat } from "node:fs/promises";
import { TextDecoder } from "node:util";
import type { Tool, ToolResult } from "../interface/Tool.js";
import { resolveProjectPath } from "../resolveProjectPath.js";

const MAX_MATCHES = 100;
const MAX_LINE_LENGTH = 300;

interface GrepInput {
    pattern: string;
    paths: string[];
}

interface GrepMatch {
    path: string;
    line: number;
    text: string;
}

interface GrepFileError {
    path: string;
    code: "NOT_FOUND" | "NOT_A_FILE" | "PERMISSION_DENIED" | "READ_FAILED";
    message: string;
}

export class GrepTool implements Tool {
    readonly name = "GrepTool";
    readonly description = "Search UTF-8 file lines with a case-insensitive regular expression.";

    constructor(private readonly projectRoot: string) {}

    async execute(input: string): Promise<ToolResult> {
        const grepInput = parseGrepInput(input);
        if (!grepInput) {
            return failure("INVALID_INPUT", "Input must be JSON with a non-empty string pattern field and a non-empty paths array of strings.");
        }

        let expression: RegExp;
        try {
            expression = new RegExp(grepInput.pattern, "i");
        } catch (error) {
            return failure("INVALID_PATTERN", `The pattern is not a valid regular expression: ${errorMessage(error)}`);
        }

        const resolvedPaths: Array<{ requestedPath: string; resolvedPath: string }> = [];
        for (const requestedPath of grepInput.paths) {
            try {
                resolvedPaths.push({
                    requestedPath,
                    resolvedPath: resolveProjectPath(this.projectRoot, requestedPath),
                });
            } catch (error) {
                return failure("INVALID_PATH", errorMessage(error));
            }
        }

        const matches: GrepMatch[] = [];
        const errors: GrepFileError[] = [];
        for (const { requestedPath, resolvedPath } of resolvedPaths) {
            if (matches.length === MAX_MATCHES) {
                break;
            }

            const content = await readUtf8File(requestedPath, resolvedPath);
            if (!content.ok) {
                errors.push(content.error);
                continue;
            }

            for (const [index, line] of content.value.split(/\r?\n/).entries()) {
                if (expression.test(line)) {
                    matches.push({
                        path: requestedPath,
                        line: index + 1,
                        text: truncateLine(line),
                    });
                }

                if (matches.length === MAX_MATCHES) {
                    break;
                }
            }
        }

        if (matches.length === 0 && errors.length === 0) {
            return failure("NO_MATCHES", `No lines matched pattern "${grepInput.pattern}".`);
        }

        return { ok: true, output: JSON.stringify({ matches, errors }) };
    }
}

async function readUtf8File(
    requestedPath: string,
    resolvedPath: string,
): Promise<{ ok: true; value: string } | { ok: false; error: GrepFileError }> {
    try {
        const fileInfo = await stat(resolvedPath);
        if (!fileInfo.isFile()) {
            return fileError(requestedPath, "NOT_A_FILE", `"${requestedPath}" is not a file.`);
        }

        const buffer = await readFile(resolvedPath);
        if (buffer.includes(0)) {
            return fileError(requestedPath, "READ_FAILED", `"${requestedPath}" is not a UTF-8 text file.`);
        }

        try {
            return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(buffer) };
        } catch {
            return fileError(requestedPath, "READ_FAILED", `"${requestedPath}" is not valid UTF-8 text.`);
        }
    } catch (error) {
        const code = nodeErrorCode(error);
        if (code === "ENOENT") {
            return fileError(requestedPath, "NOT_FOUND", `"${requestedPath}" was not found.`);
        }

        if (code === "EACCES" || code === "EPERM") {
            return fileError(requestedPath, "PERMISSION_DENIED", `Permission was denied while reading "${requestedPath}".`);
        }

        return fileError(requestedPath, "READ_FAILED", `Could not read "${requestedPath}": ${errorMessage(error)}`);
    }
}

function parseGrepInput(input: string): GrepInput | undefined {
    try {
        const value: unknown = JSON.parse(input);
        if (
            typeof value === "object"
            && value !== null
            && !Array.isArray(value)
            && "pattern" in value
            && "paths" in value
            && typeof value.pattern === "string"
            && value.pattern.trim().length > 0
            && Array.isArray(value.paths)
            && value.paths.length > 0
            && value.paths.every((path) => typeof path === "string" && path.trim().length > 0)
        ) {
            return { pattern: value.pattern, paths: [...new Set(value.paths)] };
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function truncateLine(line: string): string {
    return line.length <= MAX_LINE_LENGTH ? line : `${line.slice(0, MAX_LINE_LENGTH)}…`;
}

function fileError(
    path: string,
    code: GrepFileError["code"],
    message: string,
): { ok: false; error: GrepFileError } {
    return { ok: false, error: { path, code, message } };
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
