import assert from "node:assert/strict";
import test from "node:test";
import { CloudProvider, type CloudProviderOptions } from "../src/llm/providers/CloudProvider.js";
import { ProgressReporter, type AgentProgress } from "../src/agent/AgentProgress.js";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import { withModelUsage } from "../src/llm/usage.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const messages = [{ role: "user" as const, content: "Say hello" }];
const secret = "never-print-this-private-key";
const options = (provider: CloudProviderOptions["provider"]): CloudProviderOptions => ({ provider, model: "test-model", apiKey: secret });
function answer(provider: CloudProviderOptions["provider"], text = "Hello") {
    if (provider === "gemini") return { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } };
    if (provider === "openai") return { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 10, output_tokens: 2 } };
    return { stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 2 } };
}

for (const provider of ["gemini", "openai", "anthropic"] as const) {
    test(`${provider} recovers from 503 with bounded backoff and identical model requests`, async () => {
        const requests: { url: string; body: unknown; headers: unknown }[] = [];
        const waits: number[] = [];
        const updates: AgentProgress[] = [];
        let cancelled = 0;
        const cloud = new CloudProvider(options(provider), (async (url, init) => {
            requests.push({ url: String(url), body: init!.body, headers: init!.headers });
            if (requests.length <= 2) return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 });
            return Response.json(answer(provider));
        }) as typeof fetch, { wait: async ms => { waits.push(ms); }, random: () => 0 });
        const result = await new ProgressReporter().run(event => { updates.push(event); }, () => cloud.generate({ messages }));
        assert.equal(result.response, "Hello"); assert.equal(requests.length, 3); assert.equal(cancelled, 2);
        assert.deepEqual(requests[1], requests[0]); assert.deepEqual(requests[2], requests[0]);
        assert.deepEqual(waits, [1000, 2000]);
        assert.match(updates[0]!.message, /temporarily unavailable.*retry 1\/3/);
        assert.match(updates[2]!.message, /retry 2\/3/);
        assert.equal(JSON.stringify(updates).includes(secret), false);
    });
}

test("transient status retries stop after three retries with clear, sanitized errors", async () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529]) {
        let calls = 0; const waits: number[] = [];
        const cloud = new CloudProvider(options("gemini"), (async () => { calls++; return new Response(secret, { status }); }) as typeof fetch,
            { wait: async ms => { waits.push(ms); }, random: () => 0 });
        await assert.rejects(cloud.generate({ messages }), error => error instanceof Error && error.message.includes(String(status))
            && error.message.includes("after 3 retries") && !error.message.includes(secret)
            && (status < 500 || error.message.includes("temporarily unavailable")) && !error.message.includes("Check the model ID"));
        assert.equal(calls, 4); assert.deepEqual(waits, [1000, 2000, 4000]);
    }
});

test("permanent request errors and ambiguous network failures are never retried", async () => {
    for (const status of [400, 401, 402, 403, 404, 422, 501]) {
        let calls = 0;
        const cloud = new CloudProvider(options("gemini"), (async () => { calls++; return new Response(secret, { status }); }) as typeof fetch,
            { wait: async () => assert.fail("Must not wait"), random: () => 0 });
        await assert.rejects(cloud.generate({ messages }), error => error instanceof Error && error.message.includes(String(status)) && !error.message.includes(secret));
        assert.equal(calls, 1);
    }
    let calls = 0;
    const cloud = new CloudProvider(options("gemini"), (async () => { calls++; throw new Error(secret); }) as typeof fetch);
    await assert.rejects(cloud.generate({ messages }), /could not be reached/); assert.equal(calls, 1);
});

test("backoff adds jitter and respects Retry-After without silently waiting past its limit", async () => {
    for (const [header, expected] of [["5", 5000], ["invalid", 1125], ["0", 1125]] as const) {
        let calls = 0; const waits: number[] = [];
        const cloud = new CloudProvider(options("gemini"), (async () => ++calls === 1
            ? new Response(null, { status: 503, headers: { "Retry-After": header } }) : Response.json(answer("gemini"))) as typeof fetch,
            { wait: async ms => { waits.push(ms); }, random: () => 0.5 });
        await cloud.generate({ messages }); assert.deepEqual(waits, [expected]);
    }
    let calls = 0;
    const tooLong = new CloudProvider(options("gemini"), (async () => { calls++; return new Response(null, { status: 503, headers: { "Retry-After": "120" } }); }) as typeof fetch,
        { wait: async () => assert.fail("Must not retry before the server allows"), random: () => 0 });
    await assert.rejects(tooLong.generate({ messages }), /temporarily unavailable/); assert.equal(calls, 1);
    const waits: number[] = [];
    let dateCalls = 0;
    const date = new Date(Date.now() + 10_000).toUTCString();
    const dated = new CloudProvider(options("gemini"), (async () => ++dateCalls === 1 ? new Response(null, { status: 503, headers: { "Retry-After": date } }) : Response.json(answer("gemini"))) as typeof fetch,
        { wait: async ms => { waits.push(ms); }, random: () => 0 });
    await dated.generate({ messages }); assert.ok(waits[0]! >= 8000 && waits[0]! <= 10_000);
});

function sse(events: unknown[]) { return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")); }

test("stream requests can recover before opening, but never replay after text has arrived", async () => {
    let calls = 0; const waits: number[] = [];
    const cloud = new CloudProvider(options("gemini"), (async () => ++calls === 1 ? new Response(null, { status: 503 }) : sse([answer("gemini")])) as typeof fetch,
        { wait: async ms => { waits.push(ms); }, random: () => 0 });
    let text = "";
    await cloud.stream({ messages }, chunk => { text += chunk; });
    assert.equal(text, "Hello"); assert.equal(calls, 2); assert.deepEqual(waits, [1000]);
    let brokenCalls = 0;
    const broken = new CloudProvider(options("gemini"), (async () => { brokenCalls++; return sse([{ candidates: [{ content: { parts: [{ text: "partial" }] } }] }, { error: { message: secret } }]); }) as typeof fetch,
        { wait: async () => assert.fail("Never replay partial output"), random: () => 0 });
    text = "";
    await assert.rejects(broken.stream({ messages }, chunk => { text += chunk; }));
    assert.equal(text, "partial"); assert.equal(brokenCalls, 1);
});

test("retries reach the normal agent progress listener and count successful usage once", async () => {
    let calls = 0;
    const updates: AgentProgress[] = [];
    const cloud = new CloudProvider(options("gemini"), (async () => ++calls < 3 ? new Response(null, { status: 503 }) : Response.json(answer("gemini", '{"result":{"type":"final","answer":"Hello"}}'))) as typeof fetch,
        { wait: async () => {}, random: () => 0 });
    const previous = process.cwd();
    const directory = await mkdtemp(path.join(os.tmpdir(), "openkode-retry-"));
    try {
        await writeFile(path.join(directory, "example.ts"), "export const answer = 42;");
        process.chdir(directory);
        const result = await new OpenKodeAgent(cloud, new ConsoleTelemetry()).run({ prompt: "Explain example.ts" }, () => {}, event => { updates.push(event); });
        assert.equal(result.response, "Hello"); assert.equal(result.usage.inputTokens, 10); assert.equal(result.usage.outputTokens, 2);
        assert.equal(updates.filter(event => event.message.includes("Retrying in")).length, 2);
        assert.equal(updates.filter(event => event.message.startsWith("Reading example.ts")).length, 1, "A model retry must not replay the preceding file read");
        assert.equal(JSON.stringify(updates).includes(secret), false);
    } finally { process.chdir(previous); await rm(directory, { recursive: true, force: true }); }
    const empty = { inputTokens: 0, outputTokens: 0, totalDurationNs: 0, promptEvalDurationNs: 0, evalDurationNs: 0 };
    const outside = await withModelUsage(async () => { await cloud.generate({ messages }); return { usage: empty }; });
    assert.equal(outside!.usage.inputTokens, 10);
});
