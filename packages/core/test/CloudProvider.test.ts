import assert from "node:assert/strict";
import test from "node:test";
import { CloudProvider } from "../src/llm/providers/CloudProvider.js";
import { resolveModelConfiguration } from "../src/llm/ModelConfiguration.js";
import { withModelUsage } from "../src/llm/usage.js";
import { TelemetryLLMProvider } from "../src/llm/providers/TelemetryLLMProvider.js";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import type { TelemetryEventInterface } from "../src/telemetry/TelemetryEventInterface.js";
import { TelemetryPayloadPolicy } from "../src/telemetry/TelemetryPayloadPolicy.js";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";

const secret = "sk-test-never-upload-this-key";
const messages = [{ role: "system" as const, content: "Be helpful." }, { role: "user" as const, content: "Say hello." }];
const zero = { inputTokens: 0, outputTokens: 0, totalDurationNs: 0, promptEvalDurationNs: 0, evalDurationNs: 0 };
function answer(provider: "openai" | "anthropic", text: string) {
    return provider === "openai" ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 11, output_tokens: 4 } }
        : { stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 11, output_tokens: 4, cache_read_input_tokens: 3 } };
}

test("model selection keeps Ollama support and never borrows another provider's key", () => {
    assert.deepEqual(resolveModelConfiguration({}), { provider: "ollama", model: "qwen2.5-coder:3b" });
    assert.equal(resolveModelConfiguration({ OPENKODE_PROVIDER: "openai", OPENAI_API_KEY: secret, OPENKODE_MODEL: "chosen-model" }).model, "chosen-model");
    assert.throws(() => resolveModelConfiguration({ OPENKODE_PROVIDER: "anthropic", OPENAI_API_KEY: secret }), /ANTHROPIC_API_KEY/);
    assert.throws(() => resolveModelConfiguration({ OPENKODE_PROVIDER: "openai" }, { provider: "anthropic", model: "claude", apiKey: secret }), /OPENAI_API_KEY/);
    assert.throws(() => resolveModelConfiguration({ OPENKODE_PROVIDER: "invalid" }), /OPENKODE_PROVIDER/);
    assert.throws(() => resolveModelConfiguration({ OPENKODE_MODEL: "bad model" }), /model ID/);
    assert.equal(resolveModelConfiguration({ OPENKODE_PROVIDER: "ollama" }, { provider: "openai", model: "gpt", apiKey: secret }).model, "qwen2.5-coder:3b");
});

for (const provider of ["openai", "anthropic"] as const) {
    test(`${provider} sends credentials only in headers and maps text and cached usage`, async () => {
        const cloud = new CloudProvider({ provider, model: "selected-model", apiKey: secret }, (async (url, options) => {
            assert.equal(String(url), provider === "openai" ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages");
            assert.equal(options!.redirect, "error");
            assert.equal((options!.headers as Record<string, string>).Authorization, `Bearer ${secret}`);
            const body = JSON.parse(String(options!.body));
            assert.equal(body.model, "selected-model"); assert.equal(String(options!.body).includes(secret), false);
            if (provider === "openai") { assert.equal(body.store, false); assert.deepEqual(body.input, messages); }
            else { assert.equal(body.system, messages[0]!.content); assert.deepEqual(body.messages, [messages[1]]); assert.equal((options!.headers as Record<string, string>)["anthropic-version"], "2026-10-21"); }
            return Response.json(answer(provider, "Hello!"));
        }) as typeof fetch);
        const result = await cloud.generate({ messages });
        assert.equal(result.response, "Hello!"); assert.equal(result.usage.inputTokens, provider === "openai" ? 11 : 14);
        assert.equal(result.usage.outputTokens, 4); assert.deepEqual(cloud.info, { provider, model: "selected-model" });
    });

    test(`${provider} constrains all agent decisions and preserves tool arguments`, async () => {
        const decisions = [{ type: "final", answer: "Hello" }, { type: "needs_context", questions: ["Which file?"] }, { type: "tool_call", toolName: "WriteFileTool", path: "test.ts", content: "export const answer = 42;" }];
        let calls = 0;
        const cloud = new CloudProvider({ provider, model: "selected", apiKey: secret }, (async (_url, options) => {
            const body = JSON.parse(String(options!.body));
            const format = provider === "openai" ? body.text.format : body.output_config.format;
            assert.equal(format.type, "json_schema"); assert.equal(format.schema.type, "object");
            assert.deepEqual(format.schema.required, ["result"]); assert.ok(format.schema.properties.result.anyOf.length > 1);
            assert.match(String(options!.body), /Wire format/);
            return Response.json(answer(provider, JSON.stringify({ result: decisions[calls++] })));
        }) as typeof fetch);
        const first = await cloud.generateForOrchestrator({ messages });
        const second = await cloud.generateForPlanner({ type: "delegate", agent: "planner", task: "Investigate" });
        const third = await cloud.generateForCoder({ type: "delegate", agent: "coder", task: "Create test.ts" });
        assert.deepEqual([first, second, third], decisions);
        assert.equal(JSON.stringify(third).includes("usage"), false); assert.equal((third as any).usage.outputTokens, 4);
    });

    test(`${provider} rejects incomplete JSON and sanitizes upstream failures`, async () => {
        const make = (response: () => Response) => new CloudProvider({ provider, model: "selected", apiKey: secret }, (async () => response()) as typeof fetch);
        for (const status of [401, 403, 429, 500]) {
            await assert.rejects(make(() => new Response(`secret body ${secret}`, { status })).generate({ messages }), error =>
                error instanceof Error && error.message.includes(String(status)) && !error.message.includes(secret) && !error.message.includes("secret body"));
        }
        await assert.rejects(make(() => Response.json({ ...answer(provider, "partial"), status: "incomplete", stop_reason: "max_tokens" })).generate({ messages }), /did not finish/);
        await assert.rejects(make(() => Response.json(answer(provider, "not JSON"))).generateForOrchestrator({ messages }), /invalid decision/);
        await assert.rejects(make(() => Response.json({ status: "completed", stop_reason: "end_turn", output: {}, content: {} })).generate({ messages }), /invalid response/);
        await assert.rejects(new CloudProvider({ provider, model: "selected", apiKey: secret }, (async () => { throw new Error(secret); }) as typeof fetch).generate({ messages }), error => error instanceof Error && !error.message.includes(secret));
    });

    test(`${provider} streams split UTF-8, CRLF and final events without a trailing newline`, async () => {
        const events = provider === "openai" ? [
            { type: "response.output_text.delta", delta: "Hi 世界" },
            { type: "response.completed", response: { usage: { input_tokens: 9, output_tokens: 3 } } },
        ] : [
            { type: "message_start", message: { usage: { input_tokens: 6, output_tokens: 0, cache_read_input_tokens: 3 } } },
            { type: "content_block_delta", delta: { type: "text_delta", text: "Hi 世界" } },
            { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
            { type: "message_stop" },
        ];
        const stream = (values: unknown[]) => {
            const bytes = new TextEncoder().encode(": ping\r\n\r\n" + values.map(value => `data: ${JSON.stringify(value)}`).join("\r\n\r\n"));
            return new Response(new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3)); controller.close(); } }));
        };
        let text = "";
        const cloud = new CloudProvider({ provider, model: "selected", apiKey: secret }, (async () => stream(events)) as typeof fetch);
        const result = await cloud.stream({ messages }, chunk => { text += chunk; });
        assert.equal(text, "Hi 世界"); assert.equal(result.usage.inputTokens, 9); assert.equal(result.usage.outputTokens, 3);
        const incomplete = new CloudProvider({ provider, model: "selected", apiKey: secret }, (async () => stream(events.slice(0, -1))) as typeof fetch);
        await assert.rejects(incomplete.stream({ messages }, () => {}), /before completion/);
    });
}

test("cloud token usage reaches CLI results and telemetry and stays isolated across runs", async () => {
    const events: TelemetryEventInterface[] = [];
    const telemetry = new ConsoleTelemetry({ emit: event => { events.push(event); }, async forceFlush() {}, async shutdown() {} });
    const cloud = new CloudProvider({ provider: "openai", model: "selected", apiKey: secret }, (async () => Response.json(answer("openai", '{"result":{"type":"final","answer":"Hello"}}'))) as typeof fetch);
    Object.assign(cloud.info, { apiKey: secret }); // Adapter identity must not leak extra fields.
    const wrapped = new TelemetryLLMProvider(cloud, telemetry, new TelemetryPayloadPolicy({ captureLlmContent: false, maxContentChars: 4000 }));
    const result = await new OpenKodeAgent(wrapped, telemetry).run({ prompt: "Say hello" }, () => {});
    assert.equal(result.usage.inputTokens, 11); assert.equal(result.usage.outputTokens, 4);
    const generation = events.find(event => event.type === "generation")!;
    assert.equal(generation.llm?.provider, "openai"); assert.equal(generation.llm?.model, "selected"); assert.equal(generation.llm?.inputTokens, 11);
    assert.equal(JSON.stringify(events).includes(secret), false);
    const [one, two] = await Promise.all([1, 2].map(count => withModelUsage(async () => {
        for (let index = 0; index < count; index++) await cloud.generate({ messages });
        return { usage: zero };
    })));
    assert.equal(one!.usage.inputTokens, 11); assert.equal(two!.usage.inputTokens, 22);
});
