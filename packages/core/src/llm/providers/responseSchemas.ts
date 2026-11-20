import { coderResponseSchema } from "./coderResponseSchema.js";

const text = { type: "string" };
const texts = { type: "array", items: text };
const literal = (value: string) => ({ type: "string", enum: [value] });
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

const orchestrator = { anyOf: [
    object({ type: literal("final"), answer: text }),
    object({ type: literal("delegate"), agent: { type: "string", enum: ["planner", "coder"] }, task: text, feedback: text }),
    object({ type: literal("tool_call"), toolName: literal("ReadFileTool"), fileToRead: text }),
    object({ type: literal("tool_call"), toolName: literal("WriteFileTool"), fileToWrite: text, content: text }),
] };
const planner = { anyOf: [
    object({ type: literal("plan"), summary: text, steps: { type: "array", items: object({ id: text, description: text, files: texts, acceptanceCriteria: texts }) }, verification: texts, risks: texts }),
    object({ type: literal("needs_context"), questions: texts }),
    object({ type: literal("tool_call"), toolName: literal("ReadFileTool"), fileToRead: text }),
    object({ type: literal("tool_call"), toolName: literal("GlobTool"), pattern: text }),
    object({ type: literal("tool_call"), toolName: literal("GrepTool"), pattern: text, paths: texts }),
    object({ type: literal("research_result"), sources: texts, answer: text }),
] };

export type DecisionRole = "orchestrator" | "planner" | "coder";
// OpenAI requires an object at the schema root, rather than a top-level anyOf.
export const decisionSchema = (role: DecisionRole) => object({ result: role === "coder" ? coderResponseSchema : role === "planner" ? planner : orchestrator });

export function parseDecision<T>(value: string): T {
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed.result !== "object" || parsed.result === null || Array.isArray(parsed.result)
            || typeof parsed.result.type !== "string") throw new Error();
        return parsed.result as T;
    } catch { throw new Error("The model returned an invalid decision. Retry the request or choose another model."); }
}
