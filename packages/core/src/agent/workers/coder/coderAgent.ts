import type { LLMProvider } from "../../../llm/interface/LLMProvider.js";
import type { CoderResponse } from "../../interface/CoderResponsetypes.js";
import type { Delegate } from "../../interface/OrchestratorResponsetypes.js";
import type { PlannerResponse } from "../../interface/PlannerResponsetype.js";

export class CoderAgent{
    constructor(private readonly llm:LLMProvider){}

    async run(task:Delegate):Promise<CoderResponse> {
        const response: unknown = await this.llm.generateForCoder(task);
        return validateCoderResponse(response);
    }
}

function validateCoderResponse(value: unknown): CoderResponse {
    if (!isRecord(value) || typeof value.type !== "string") {
        return invalidResponse();
    }

    if (
        value.type === "tool_call" &&
        value.toolName === "EditFileTool" &&
        isString(value.path) &&
        isString(value.oldText) &&
        isString(value.newText)
    ) {
        return {
            type: "tool_call",
            toolName: "EditFileTool",
            path: value.path,
            oldText: value.oldText,
            newText: value.newText,
        };
    }

    if (
        value.type === "tool_call" &&
        value.toolName === "WriteFileTool" &&
        isString(value.path) &&
        isString(value.content)
    ) {
        return {
            type: "tool_call",
            toolName: "WriteFileTool",
            path: value.path,
            content: value.content,
        };
    }

    if (
        value.type === "tool_call" &&
        value.toolName === "GrepTool" &&
        isString(value.pattern) &&
        isStringArray(value.paths)
    ) {
        return {
            type: "tool_call",
            toolName: "GrepTool",
            pattern: value.pattern,
            paths: value.paths,
        };
    }

    if (
        value.type === "completed" &&
        isString(value.summary) &&
        isStringArray(value.verification) &&
        isStringArray(value.risks)
    ) {
        return {
            type: "completed",
            summary: value.summary,
            verification: value.verification,
            risks: value.risks,
        };
    }

    if (value.type === "needs_context" && isStringArray(value.questions)) {
        return { type: "needs_context", questions: value.questions };
    }

    return invalidResponse();
}

function invalidResponse(): CoderResponse {
    return {
        type: "invalid_response",
        message: "Return exactly one allowed response shape: tool_call, completed, or needs_context.",
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isString);
}
