import assert from "node:assert/strict";
import test from "node:test";
import { CloudProvider } from "../src/llm/providers/CloudProvider.js";
import { createModelProvider, resolveModelConfiguration } from "../src/llm/ModelConfiguration.js";
import { withModelUsage } from "../src/llm/usage.js";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import { TelemetryLLMProvider } from "../src/llm/providers/TelemetryLLMProvider.js";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import { TelemetryPayloadPolicy } from "../src/telemetry/TelemetryPayloadPolicy.js";
import type { TelemetryEventInterface } from "../src/telemetry/TelemetryEventInterface.js";

const secret = "gemini-test-private-key";
const messages = [{ role: "system" as const, content: "Be helpful." }, { role: "user" as const, content: "Hello" }, { role: "assistant" as const, content: "Hi" }, { role: "user" as const, content: "Continue" }];
const metadata = { promptTokenCount: 12, cachedContentTokenCount: 4, candidatesTokenCount: 3, thoughtsTokenCount: 5 };
const answer = (text = "Hello 世界", finishReason = "STOP") => ({ candidates: [{ content: { parts: [{ thought: true, text: "private thought" }, { text }] }, finishReason }], usageMetadata: metadata });
const make = (response: () => Response) => new CloudProvider({ provider: "gemini", model: "gemini-4-hydrogen", apiKey: secret }, (async () => response()) as typeof fetch);

test("Gemini selection uses its own key and model, with environment overrides", () => {
    const saved = { provider: "gemini" as const, model: "saved-model", apiKey: secret };
    assert.deepEqual(resolveModelConfiguration({}, saved), saved);
    assert.deepEqual(resolveModelConfiguration({ OPENKODE_PROVIDER: "gemini", GEMINI_API_KEY: secret }), { provider: "gemini", model: "gemini-4-hydrogen", apiKey: secret });
    assert.equal(resolveModelConfiguration({ OPENKODE_MODEL: "custom-model", GEMINI_API_KEY: "new-key" }, saved).apiKey, "new-key");
    assert.equal(resolveModelConfiguration({ OPENKODE_MODEL: "custom-model" }, saved).model, "custom-model");
    assert.throws(() => resolveModelConfiguration({ OPENKODE_PROVIDER: "gemini", OPENAI_API_KEY: secret, ANTHROPIC_API_KEY: secret }), /GEMINI_API_KEY/);
    assert.throws(() => resolveModelConfiguration({ OPENKODE_PROVIDER: "gemini" }, { provider: "openai", model: "gpt", apiKey: secret }), /GEMINI_API_KEY/);
    assert.throws(() => resolveModelConfiguration({ OPENKODE_PROVIDER: "openai" }, saved), /OPENAI_API_KEY/);
    assert.deepEqual(createModelProvider(saved).info, { provider: "gemini", model: "saved-model" });
});

test("Gemini maps system and model roles, keeps keys in headers, and counts thinking without double counting cache", async () => {
    const cloud = new CloudProvider({ provider: "gemini", model: "models/gemini-4-hydrogen", apiKey: secret }, (async (url, options) => {
        assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
        assert.equal(options!.redirect, "error");
        assert.equal((options!.headers as any)["x-goog-api-key"], secret);
        assert.equal((options!.headers as any).Authorization, undefined);
        assert.equal(String(options!.body).includes(secret), false);
        const body = JSON.parse(String(options!.body));
        assert.deepEqual(body.systemInstruction, { parts: [{ text: "Be helpful." }] });
        assert.deepEqual(body.contents.map((message: any) => message.role), ["user", "model", "user"]);
        assert.equal(body.contents[2].parts[0].text, "Continue");
        assert.equal(body.generationConfig.maxOutputTokens, 8192);
        return Response.json(answer());
    }) as typeof fetch);
    const result = await cloud.generate({ messages });
    assert.equal(result.response, "Hello 世界");
    assert.equal(result.usage.inputTokens, 12); assert.equal(result.usage.outputTokens, 8);
});

test("Gemini constrains orchestrator, planner, and coder decisions and preserves tools", async () => {
    const decisions = [{ type: "final", answer: "Hello" }, { type: "needs_context", questions: ["Which file?"] }, { type: "tool_call", toolName: "WriteFileTool", path: "test.ts", content: "export const x = 42;" }];
    let calls = 0;
    const cloud = new CloudProvider({ provider: "gemini", model: "selected", apiKey: secret }, (async (_url, options) => {
        const body = JSON.parse(String(options!.body));
        assert.equal(body.generationConfig.responseMimeType, "application/json");
        const schema = body.generationConfig.responseJsonSchema;
        assert.deepEqual(schema.required, ["result"]); assert.ok(schema.properties.result.anyOf.length > 1);
        assert.match(JSON.stringify(body.systemInstruction), /Wire format/);
        return Response.json(answer(JSON.stringify({ result: decisions[calls++] })));
    }) as typeof fetch);
    const results = [await cloud.generateForOrchestrator({ messages }), await cloud.generateForPlanner({ type: "delegate", agent: "planner", task: "Plan" }), await cloud.generateForCoder({ type: "delegate", agent: "coder", task: "Code" })];
    assert.deepEqual(results, decisions); assert.equal(JSON.stringify(results).includes("usage"), false);
    assert.equal((results[2] as any).usage.outputTokens, 8);
});

test("Gemini rejects safety blocks, truncation, malformed responses and sanitizes failures", async () => {
    for (const status of [400, 401, 403, 429, 500]) {
        await assert.rejects(make(() => new Response(secret, { status })).generate({ messages }), error => error instanceof Error && error.message.includes(String(status)) && !error.message.includes(secret));
    }
    for (const data of [answer("partial", "MAX_TOKENS"), answer("blocked", "SAFETY"), {}, { candidates: {} }, { error: { message: secret } }, { promptFeedback: { blockReason: "SAFETY" } }, { ...answer(), usageMetadata: { promptTokenCount: -1 } }, { ...answer(), candidates: [{ finishReason: "STOP", content: { parts: {} } }] }]) {
        await assert.rejects(make(() => Response.json(data)).generate({ messages }), error => error instanceof Error && !error.message.includes(secret));
    }
    await assert.rejects(make(() => Response.json(answer("bad JSON"))).generateForOrchestrator({ messages }), /invalid decision/);
    await assert.rejects(make(() => new Response("bad JSON")).generate({ messages }), /invalid response/);
    await assert.rejects(make(() => { throw new Error(secret); }).generate({ messages }), error => error instanceof Error && !error.message.includes(secret));
});

function stream(events: unknown[]) {
    const bytes = new TextEncoder().encode(": ping\r\n\r\n" + events.map(event => `data: ${JSON.stringify(event)}`).join("\r\n\r\n"));
    return new Response(new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index += 2) controller.enqueue(bytes.slice(index, index + 2)); controller.close(); } }));
}

test("Gemini streams split UTF-8 and final usage, hides thoughts, and requires completion", async () => {
    const events = [{ candidates: [{ content: { parts: [{ thought: true, text: "hidden" }, { text: "Hello 世界" }] } }], usageMetadata: { promptTokenCount: 12 } }, { candidates: [{ finishReason: "STOP" }] }, { usageMetadata: metadata }];
    const cloud = new CloudProvider({ provider: "gemini", model: "selected", apiKey: secret }, (async (url) => {
        assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/selected:streamGenerateContent?alt=sse");
        return stream(events);
    }) as typeof fetch);
    let text = "";
    const result = await cloud.stream({ messages }, chunk => { text += chunk; });
    assert.equal(text, "Hello 世界"); assert.equal(result.usage.inputTokens, 12); assert.equal(result.usage.outputTokens, 8);
    for (const invalid of [events.slice(0, 1), events.slice(0, 2), [{ error: { message: secret } }], [answer("blocked", "SAFETY")], [{ promptFeedback: { blockReason: "SAFETY" } }]]) {
        await assert.rejects(make(() => stream(invalid)).stream({ messages }, () => {}), error => error instanceof Error && !error.message.includes(secret));
    }
});

test("Gemini usage and provider identity reach agent results and telemetry without credentials", async () => {
    const events: TelemetryEventInterface[] = [];
    const telemetry = new ConsoleTelemetry({ emit: event => { events.push(event); }, async forceFlush() {}, async shutdown() {} });
    const cloud = make(() => Response.json(answer('{"result":{"type":"final","answer":"Hello"}}')));
    const wrapped = new TelemetryLLMProvider(cloud, telemetry, new TelemetryPayloadPolicy({ captureLlmContent: false, maxContentChars: 4000 }));
    const result = await new OpenKodeAgent(wrapped, telemetry).run({ prompt: "Say hello" }, () => {});
    assert.equal(result.usage.inputTokens, 12); assert.equal(result.usage.outputTokens, 8);
    const event = events.find(event => event.type === "generation")!;
    assert.equal(event.llm?.provider, "gemini"); assert.equal(event.llm?.model, "gemini-4-hydrogen"); assert.equal(event.llm?.outputTokens, 8);
    assert.equal(JSON.stringify(events).includes(secret), false);
    const aggregate = await withModelUsage(async () => { await cloud.generate({ messages }); await cloud.generate({ messages }); return { usage: result.usage }; });
    assert.equal(aggregate!.usage.inputTokens, 24); assert.equal(aggregate!.usage.outputTokens, 16);
});
