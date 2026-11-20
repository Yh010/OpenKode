import assert from "node:assert/strict";
import { AuthenticatedSession, configureAuthNetwork } from "../../packages/cli/src/auth/AuthenticatedSession.ts";
import { OpenKodeAgent } from "../../packages/core/src/agent/OpenKodeAgent.ts";
import { CloudProvider } from "../../packages/core/src/llm/providers/CloudProvider.ts";
import { TelemetryLLMProvider } from "../../packages/core/src/llm/providers/TelemetryLLMProvider.ts";
import { ConsoleTelemetry } from "../../packages/core/src/telemetry/ConsoleTelemetry.ts";
import { TelemetryApiClient } from "../../packages/core/src/telemetry/TelemetryApiClient.ts";
import type { TelemetryEventInterface } from "../../packages/core/src/telemetry/TelemetryEventInterface.ts";

// One synthetic failed trace, no paid model requests or project files.
const restore = configureAuthNetwork();
try {
    const identity = await AuthenticatedSession.open();
    const events: TelemetryEventInterface[] = [];
    const telemetry = new ConsoleTelemetry({ emit: event => { events.push(event); }, async forceFlush() {}, async shutdown() {} });
    let calls = 0;
    const cloud = new CloudProvider({ provider: "gemini", model: "synthetic-failure-check", apiKey: "synthetic-test-key" }, (async () => {
        if (++calls === 1) return new Response(null, { status: 503 });
        return new Response([{ candidates: [{ content: { parts: [{ text: '{"result":{"type":"final","answer":"Synthetic partial answer' }] } }] },
            { error: { message: "Synthetic broken stream" } }].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
    }) as typeof fetch, { wait: async () => {}, random: () => 0 });
    const question = "hi, synthetic failure capture check";
    await assert.rejects(new OpenKodeAgent(new TelemetryLLMProvider(cloud, telemetry), telemetry).run({ prompt: question, stream: true,
        ownership: { userId: identity.user.id, installationId: identity.installationId, sessionId: identity.sessionId } }, () => {}));
    const origin = process.env.COLLECTOR_TEST_URL ?? "https://openkode-collector.onrender.com";
    await new TelemetryApiClient(`${origin}/v1/telemetry/events`, () => identity.token()).sendBatch(events);
    const run = events.find(event => event.type === "run")!;
    const response = await fetch(`${origin}/v1/telemetry/traces/${run.runId}`, { headers: { Authorization: `Bearer ${await identity.token()}` }, signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200);
    const trace = await response.json() as { events: TelemetryEventInterface[] };
    assert.equal(trace.events.find(event => event.type === "run")!.status, "error");
    const stored = JSON.stringify(trace.events);
    for (const field of [question, "Synthetic partial answer", "incomplete", "originalRequest", "partialOutput", "attempts"]) assert.ok(stored.includes(field));
    const generation = trace.events.find(event => event.type === "generation")!;
    assert.deepEqual((generation.metadata!.attempts as { status: number }[]).map(value => value.status), [503, 200]);
    assert.ok(!stored.includes("synthetic-test-key"));
    console.log(`PASS: failed trace stored and read from hosted collector with question, partial output, error, retries and ownership. Synthetic run: ${run.runId}`);
} finally { restore(); }
