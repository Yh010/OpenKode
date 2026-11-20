import { AsyncLocalStorage } from "node:async_hooks";
import { stripVTControlCharacters } from "node:util";
import type { ToolResult } from "../tools/interface/Tool.js";

export type AgentProgress = { kind: "status" | "result"; message: string; detail?: string };
export type ProgressListener = (event: AgentProgress) => void;

/** Local execution updates, independent of telemetry and model reasoning. */
export class ProgressReporter {
    private readonly listeners = new AsyncLocalStorage<ProgressListener>();
    run<T>(listener: ProgressListener | undefined, operation: () => Promise<T>): Promise<T> {
        return this.listeners.run(listener ?? (() => {}), operation);
    }
    emit(event: AgentProgress): void {
        try {
            this.listeners.getStore()?.({ kind: event.kind, message: preview(event.message, 1, 220),
                ...(event.detail ? { detail: preview(event.detail) } : {}) });
        } catch { /* A display failure must not interrupt the agent. */ }
    }
}

export function toolProgress(tool: string, input: unknown, result?: ToolResult, invoked = true): AgentProgress {
    const fields = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const target = [fields.path, fields.fileToRead, fields.fileToWrite, fields.pattern, fields.script].find(value => typeof value === "string") as string | undefined;
    const label = target ? ` ${target}` : "";
    const action: Record<string, string> = { ReadFileTool: "Reading", GlobTool: "Finding files matching", GrepTool: "Searching for", EditFileTool: "Editing", WriteFileTool: "Writing", RunCommandTool: "Running" };
    if (!result) return { kind: "status", message: invoked ? `${action[tool] ?? "Running tool"}${label}` : `Checking permission for ${tool}${label}` };
    if (!result.ok) return { kind: "result", message: `${invoked ? "Could not complete" : "Blocked"} ${tool}${label}`, detail: `${result.code}: ${tool === "RunCommandTool" ? commandOutput(result.message) : result.message}` };
    if (tool === "ReadFileTool") {
        const lines = result.output ? result.output.split(/\r?\n/).length : 0;
        return { kind: "result", message: `Read${label} (${lines} ${lines === 1 ? "line" : "lines"})`, detail: preview(result.output, 4, 600) };
    }
    if (tool === "GlobTool" || tool === "GrepTool") {
        try {
            const data = JSON.parse(result.output);
            if (Array.isArray(data.matches)) {
                const matches = data.matches;
                const errors = Array.isArray(data.errors) ? data.errors : [];
                return { kind: "result", message: `Found ${matches.length} ${tool === "GlobTool" ? "files" : "matches"}${errors.length ? ` (${errors.length} files could not be searched)` : ""}`,
                    detail: matches.slice(0, 5).map((match: any) => typeof match === "string" ? match : `${match.path}:${match.line}: ${match.text}`).join("\n") + (matches.length > 5 ? `\n… ${matches.length - 5} more` : "") };
            }
        } catch { /* Keep malformed tool output out of the display. */ }
        return { kind: "result", message: `${tool} finished` };
    }
    const done: Record<string, string> = { EditFileTool: "Edited", WriteFileTool: "Wrote", RunCommandTool: "Finished running" };
    return { kind: "result", message: `${done[tool] ?? "Finished tool"}${label}`, ...(tool === "RunCommandTool" ? { detail: commandOutput(result.output) } : {}) };
}

function commandOutput(value: string): string {
    try {
        const data = JSON.parse(value);
        if (typeof data.output === "string") return `Exit code: ${data.exitCode ?? "unknown"}${data.timedOut ? " (timed out)" : ""}\n${data.output}`;
    } catch { /* Validation errors are already plain text. */ }
    return value;
}

function preview(value: string, maxLines = 6, maxChars = 900): string {
    const clean = stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
        .replace(/(authorization["']?\s*[:=]\s*["']?bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
        .replace(/((?:[\w-]*(?:api[_-]?key|password|secret|token))["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
        .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,})\b/g, "[REDACTED]");
    const lines = clean.split(/\r?\n/);
    const clipped = lines.slice(0, maxLines).join("\n").slice(0, maxChars);
    return clipped + (lines.length > maxLines || clipped.length < clean.length ? maxLines === 1 ? "…" : "\n…" : "");
}
