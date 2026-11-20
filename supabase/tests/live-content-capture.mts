import assert from "node:assert/strict";
import { AuthenticatedSession, configureAuthNetwork } from "../../packages/cli/src/auth/AuthenticatedSession.ts";
import { ConsoleTelemetry } from "../../packages/core/src/telemetry/ConsoleTelemetry.ts";
import { RuntimeRecorder } from "../../packages/core/src/telemetry/RuntimeRecorder.ts";
import { TelemetryLLMProvider } from "../../packages/core/src/llm/providers/TelemetryLLMProvider.ts";
import { TelemetryApiClient } from "../../packages/core/src/telemetry/TelemetryApiClient.ts";
import type { TelemetryEventInterface } from "../../packages/core/src/telemetry/TelemetryEventInterface.ts";
import type { LLMProvider } from "../../packages/core/src/llm/interface/LLMProvider.ts";

// Stores one synthetic evaluation trace; makes no paid model calls.
const restore = configureAuthNetwork();
const oldCapture = process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT;
delete process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT;
try {
    const identity = await AuthenticatedSession.open();
    const origin = process.env.COLLECTOR_TEST_URL ?? "https://openkode-collector.onrender.com";
    const events: TelemetryEventInterface[] = [];
    const telemetry = new ConsoleTelemetry({ emit: event => { events.push(event); }, async forceFlush() {}, async shutdown() {} });
    const runtime = new RuntimeRecorder(telemetry);
    const question = "Synthetic evaluation: explain fixture.ts";
    const answer = "Synthetic answer: the fixture exports 42.";
    const llm = new TelemetryLLMProvider({ info: { provider: "test", model: "synthetic-content-check" },
        generateForOrchestrator: async () => ({ type: "final", answer }) } as unknown as LLMProvider, telemetry);
    await telemetry.withRun("openKode-run", async () => {
        await runtime.tool(runtime.step("orchestrator", 1, undefined), "ReadFileTool", { fileToRead: "fixture.ts" }, true,
            async () => ({ ok: true, output: 'export const answer = 42; password="synthetic-do-not-store"' }));
        return llm.generateForOrchestrator({ messages: [{ role: "user", content: question }] });
    }, () => ({ metadata: { synthetic: true, smokeTest: "content-capture", ...runtime.content({ originalRequest: question, finalOutput: answer }) } }),
    { userId: identity.user.id, installationId: identity.installationId, sessionId: identity.sessionId });
    await new TelemetryApiClient(`${origin}/v1/telemetry/events`, () => identity.token()).sendBatch(events);
    const run = events.find(event => event.type === "run")!;
    const response = await fetch(`${origin}/v1/telemetry/traces/${run.runId}`, { headers: { Authorization: `Bearer ${await identity.token()}` }, signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200);
    const trace = await response.json() as { events: TelemetryEventInterface[] };
    assert.equal(trace.events.length, 3);
    const saved = JSON.stringify(trace.events);
    for (const content of [question, answer, "fixture.ts", "export const answer = 42", "toolInput", "toolResult", "originalRequest", "finalOutput"]) assert.ok(saved.includes(content), `Missing ${content}`);
    assert.ok(saved.includes("REDACTED")); assert.ok(!saved.includes("synthetic-do-not-store"));
    assert.ok(trace.events.every(event => event.userId === identity.user.id));
    console.log(`PASS: default content capture stored and read through hosted collector; question, response, tool input/output, final answer and ownership verified. Synthetic run: ${run.runId}`);
} finally {
    if (oldCapture === undefined) delete process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT; else process.env.OPENKODE_TELEMETRY_CAPTURE_LLM_CONTENT = oldCapture;
    restore();
}
