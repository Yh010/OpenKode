import type { LLMProvider } from "../../../llm/interface/LLMProvider.js";
import type { Delegate } from "../../interface/OrchestratorResponsetypes.js";
import type { Plan, PlannerResponse } from "../../interface/PlannerResponsetype.js";

export class PlannerAgent{
    constructor(private readonly llm:LLMProvider){}

    async run(task:Delegate):Promise<PlannerResponse> {
        const response: unknown = await this.llm.generateForPlanner(task);
        return validatePlannerResponse(response);
    }
}

function validatePlannerResponse(value: unknown): PlannerResponse {
    if (!isRecord(value) || typeof value.type !== "string") {
        return invalidResponse();
    }

    if (value.type === "tool_call" && value.toolName === "ReadFileTool" && isString(value.fileToRead)) {
        return { type: "tool_call", toolName: "ReadFileTool", fileToRead: value.fileToRead };
    }

    if (value.type === "needs_context" && isStringArray(value.questions)) {
        return { type: "needs_context", questions: value.questions };
    }

    if (isPlan(value)) {
        return value;
    }

    return invalidResponse();
}

function isPlan(value: Record<string, unknown>): value is Plan & Record<string, unknown> {
    return value.type === "plan"
        && isString(value.summary)
        && isStringArray(value.verification)
        && isStringArray(value.risks)
        && Array.isArray(value.steps)
        && value.steps.every(isPlanStep);
}

function isPlanStep(value: unknown): boolean {
    return isRecord(value)
        && isString(value.id)
        && isString(value.description)
        && isStringArray(value.files)
        && isStringArray(value.acceptanceCriteria);
}

function invalidResponse(): PlannerResponse {
    return {
        type: "invalid_response",
        message: "Return exactly one allowed response shape: tool_call, plan, or needs_context.",
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
