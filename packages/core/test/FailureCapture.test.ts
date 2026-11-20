import assert from "node:assert/strict";
import test from "node:test";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import { TelemetryLLMProvider } from "../src/llm/providers/TelemetryLLMProvider.js";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import { CloudProvider } from "../src/llm/providers/CloudProvider.js";
import { TelemetryPayloadPolicy } from "../src/telemetry/TelemetryPayloadPolicy.js";
import type { LLMProvider } from "../src/llm/interface/LLMProvider.js";
import type { TelemetryEventInterface } from "../src/telemetry/TelemetryEventInterface.js";

function recorder() {
    const events: TelemetryEventInterface[] = [];
    const telemetry = new ConsoleTelemetry({ emit: event => { events.push(event); }, async forceFlush() {}, async shutdown() {} });
    return { events, telemetry };
}

test("failed generation methods keep their inputs, provider, error and original exception", async () => {
    const { events, telemetry } = recorder();
    const failure = new Error('Synthetic failure password="do-not-store"');
    const fail = async () => { throw failure; };
    const provider = new TelemetryLLMProvider({ info: { provider: "test", model: "failure-model" }, generate: fail, generateForOrchestrator: fail,
        generateForPlanner: fail, generateForCoder: fail } as unknown as LLMProvider, telemetry);
    for (const operation of [() => provider.generate({ messages: [{ role: "user", content: "Original question" }] }),
        () => provider.generateForOrchestrator({ messages: [{ role: "user", content: "Original question" }] }),
        () => provider.generateForPlanner({ type: "delegate", agent: "planner", task: "Original question" }),
        () => provider.generateForCoder({ type: "delegate", agent: "coder", task: "Original question" })]) {
        await assert.rejects(telemetry.withRun("test", operation), error => error === failure);
    }
    const generations = events.filter(event => event.type === "generation");
    assert.equal(generations.length, 4);
    for (const event of generations) {
        assert.equal(event.status, "error"); assert.equal(event.llm?.model, "failure-model");
        assert.equal(event.metadata?.incomplete, true); assert.match(JSON.stringify(event.metadata), /Original question/);
    }
    assert.doesNotMatch(JSON.stringify(events), /do-not-store/);
});

test("503 failures retain all retry outcomes and the failed run's question and ownership", async () => {
    const { events, telemetry } = recorder();
    const cloud = new CloudProvider({ provider: "gemini", model: "test-model", apiKey: "private-test-key" }, (async () => new Response(null, { status: 503 })) as typeof fetch,
        { wait: async () => {}, random: () => 0 });
    const ownership = { userId: "test-user", installationId: "test-installation", sessionId: "test-session" };
    await assert.rejects(new OpenKodeAgent(new TelemetryLLMProvider(cloud, telemetry), telemetry).run({ prompt: "hi", ownership, chatId: "test-chat" }, () => {}), /503/);
    const root = events.find(event => event.type === "run")!;
    assert.equal(root.status, "error"); assert.equal(root.userId, ownership.userId); assert.equal(root.chatId, "test-chat");
    assert.match(JSON.stringify(root.metadata?.runtimeContent), /originalRequest.*hi/);
    const generation = events.find(event => event.type === "generation")!;
    const attempts = generation.metadata!.attempts as { status: number }[];
    assert.deepEqual(attempts.map(attempt => attempt.status), [503, 503, 503, 503]);
    assert.doesNotMatch(JSON.stringify(events), /private-test-key/);
});

test("broken structured streams keep partial provider output and the partial answer shown to the user", async () => {
    const { events, telemetry } = recorder();
    const cloud = new CloudProvider({ provider: "gemini", model: "test", apiKey: "test-key" }, (async () => new Response([
        { candidates: [{ content: { parts: [{ text: '{"result":{"type":"final","answer":"Partial answer' }] } }] },
        { error: { message: "synthetic stream failure" } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""))) as typeof fetch);
    let shown = "";
    await assert.rejects(new OpenKodeAgent(new TelemetryLLMProvider(cloud, telemetry), telemetry).run({ prompt: "hi", stream: true }, chunk => { shown += chunk; }));
    assert.equal(shown, "Partial answer");
    const generation = events.find(event => event.type === "generation")!;
    assert.equal(generation.metadata!.partialOutputAvailable, true);
    assert.match(JSON.stringify(generation.metadata), /Partial answer/);
    const root = events.find(event => event.type === "run")!;
    assert.equal(root.metadata!.incomplete, true); assert.match(JSON.stringify(root.metadata!.runtimeContent), /partialOutput.*Partial answer/);
});

test("explicit capture-off still hides inputs and partial content on failures", async () => {
    const { events, telemetry } = recorder();
    const provider = new TelemetryLLMProvider({ info: { provider: "test", model: "test" }, stream: async (_request: unknown, onChunk: (text: string) => void) => {
        onChunk("private output"); throw new Error("Synthetic failure");
    } } as unknown as LLMProvider, telemetry, new TelemetryPayloadPolicy({ captureLlmContent: false, maxContentChars: 4000 }));
    await assert.rejects(telemetry.withRun("test", () => provider.stream({ messages: [{ role: "user", content: "private input" }] }, () => {})));
    assert.doesNotMatch(JSON.stringify(events), /private input|private output/);
    assert.equal(events.find(event => event.type === "generation")!.metadata!.incomplete, true);
});
