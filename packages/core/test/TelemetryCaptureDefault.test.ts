import assert from "node:assert/strict";
import test from "node:test";
import { TelemetryPayloadPolicy } from "../src/telemetry/TelemetryPayloadPolicy.js";
import { RuntimeRecorder } from "../src/telemetry/RuntimeRecorder.js";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import { TelemetryLLMProvider } from "../src/llm/providers/TelemetryLLMProvider.js";
import type { LLMProvider } from "../src/llm/interface/LLMProvider.js";
import type { TelemetryEventInterface } from "../src/telemetry/TelemetryEventInterface.js";

test("capture defaults on for missing/blank settings and only explicit false disables it", () => {
    for (const value of [undefined, "", "true"]) {
        const policy = TelemetryPayloadPolicy.fromEnvironment(value === undefined ? {} : { OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT: value });
        assert.equal(policy.captureLlmContent, true);
        assert.ok(policy.generationMetadata({ messages: [{ role: "user", content: "Question" }] }, "Answer"));
    }
    assert.equal(TelemetryPayloadPolicy.fromEnvironment({ OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT: " FALSE " }).captureLlmContent, false);
    assert.equal(TelemetryPayloadPolicy.fromEnvironment({}).maxContentChars, 4000);
});

test("default capture serializes prompts, answers and tool input/output into exportable trace events", async () => {
    const previous = process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT;
    delete process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT;
    const events: TelemetryEventInterface[] = [];
    try {
        const telemetry = new ConsoleTelemetry({ emit: event => { events.push(event); }, async forceFlush() {}, async shutdown() {} });
        const runtime = new RuntimeRecorder(telemetry);
        const question = "Explain the synthetic fixture";
        const llm = new TelemetryLLMProvider({ info: { provider: "test", model: "synthetic" }, generateForOrchestrator: async () => ({ type: "final", answer: "The fixture exports 42." }) } as unknown as LLMProvider, telemetry);
        await telemetry.withRun("capture-test", async () => {
            await runtime.tool(runtime.step("orchestrator", 1, undefined), "ReadFileTool", { fileToRead: "fixture.ts" }, true,
                async () => ({ ok: true, output: 'export const answer = 42; password="never-store-this"' }));
            return llm.generateForOrchestrator({ messages: [{ role: "user", content: question }] });
        }, result => ({ metadata: runtime.content({ originalRequest: question, finalOutput: result.type === "final" ? result.answer : "" }) }));
        const wire = JSON.stringify({ events });
        const stored = JSON.parse(wire).events as TelemetryEventInterface[];
        assert.match(wire, /Explain the synthetic fixture/); assert.match(wire, /The fixture exports 42/);
        assert.match(wire, /fixture.ts/); assert.match(wire, /export const answer = 42/);
        assert.doesNotMatch(wire, /never-store-this/); assert.match(wire, /REDACTED/);
        assert.ok(stored.find(event => event.type === "generation")!.metadata!.llm);
        const run = stored.find(event => event.type === "run")!;
        assert.ok((run.metadata!.runtimeContent as any).originalRequest);
        assert.ok((run.metadata!.runtimeContent as any).finalOutput);
        const tool = stored.find(event => event.type === "tool")!;
        assert.ok((tool.metadata!.runtimeContent as any).toolInput);
        assert.ok((tool.metadata!.runtimeContent as any).toolResult);
    } finally {
        if (previous === undefined) delete process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT; else process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT = previous;
    }
});
