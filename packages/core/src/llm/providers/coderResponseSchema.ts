const text = { type: "string" };
const texts = { type: "array", items: text };
const literal = (value: string) => ({ type: "string", enum: [value] });
function shape(properties: Record<string, unknown>) {
    return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

/** Constrain generation to the protocol CoderAgent actually accepts, not just arbitrary JSON. */
export const coderResponseSchema = {
    anyOf: [
        shape({ type: literal("tool_call"), toolName: literal("EditFileTool"), path: text, oldText: text, newText: text }),
        shape({ type: literal("tool_call"), toolName: literal("WriteFileTool"), path: text, content: text }),
        shape({ type: literal("tool_call"), toolName: literal("GrepTool"), pattern: text, paths: texts }),
        shape({ type: literal("tool_call"), toolName: literal("RunCommandTool"), script: { type: "string", enum: ["test", "lint", "build", "format:check"] } }),
        shape({ type: literal("completed"), summary: text, verification: texts, risks: texts }),
        shape({ type: literal("needs_context"), questions: texts }),
    ],
};
