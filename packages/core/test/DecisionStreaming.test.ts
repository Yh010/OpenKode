import assert from "node:assert/strict";
import test from "node:test";
import { DecisionStream } from "../src/llm/DecisionStream.js";
import { CloudProvider } from "../src/llm/providers/CloudProvider.js";
import { OllamaProvider } from "../src/llm/providers/OllamaProvider.js";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import { TelemetryLLMProvider } from "../src/llm/providers/TelemetryLLMProvider.js";

test("answer extraction streams decoded text and never exposes tool JSON or escaped internal content", () => {
    const answer = 'Hello "world"\n世界 😀 \\ done';
    let visible = "";
    const output = new DecisionStream(true, value => value.type === "final", chunk => { visible += chunk; });
    const raw = JSON.stringify({ result: { type: "final", answer } }).replace("😀", "\\ud83d\\ude00");
    for (const char of raw) output.append(char);
    assert.ok(visible.length > 0);
    output.finish({ type: "final", answer });
    assert.equal(visible, answer);
    let leaked = "";
    const tool = new DecisionStream(true, value => value.type === "final", chunk => { leaked += chunk; });
    tool.append(JSON.stringify({ result: { type: "tool_call", content: '{"type":"final","answer":"never show this"}' } }));
    tool.finish({ type: "tool_call" }); assert.equal(leaked, "");
});

test("research answers wait for completed source evidence, including reversed property order", () => {
    const accept = (value: any) => value.type === "research_result" && value.sources?.length > 0 && value.sources.every((source: string) => source === "known.ts");
    let visible = "";
    const output = new DecisionStream(true, accept, chunk => { visible += chunk; });
    output.append('{"result":{"type":"research_result","answer":"Unsupported answer","sources":["known.ts"');
    assert.equal(visible, "", "A partial sources array is not verified evidence");
    output.append(',"unknown.ts"]}}');
    output.finish({ type: "research_result", sources: ["known.ts", "unknown.ts"], answer: "Unsupported answer" });
    assert.equal(visible, "");
    const valid = new DecisionStream(true, accept, chunk => { visible += chunk; });
    valid.append('{"result":{"type":"research_result","sources":["known.ts"],"answer":"Verified');
    assert.equal(visible, "Verified");
    valid.append(' answer"}}'); valid.finish({ type: "research_result", sources: ["known.ts"], answer: "Verified answer" });
    assert.equal(visible, "Verified answer");
});

for (const provider of ["gemini", "openai", "anthropic"] as const) {
    test(`${provider} delivers answer chunks before completion and preserves the final result and token usage`, { timeout: 5000 }, async () => {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const encoder = new TextEncoder();
        const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        const delta = (text: string) => provider === "gemini" ? { candidates: [{ content: { parts: [{ text }] } }] }
            : provider === "openai" ? { type: "response.output_text.delta", delta: text } : { type: "content_block_delta", delta: { type: "text_delta", text } };
        let signal!: () => void; const received = new Promise<void>(resolve => { signal = resolve; });
        let visible = "";
        const cloud = new CloudProvider({ provider, model: "selected", apiKey: "synthetic-test-key" }, (async (_url, options) => {
            const body = JSON.parse(String(options!.body));
            if (provider === "gemini") assert.ok(body.generationConfig.responseJsonSchema); else assert.equal(body.stream, true);
            const stream = new ReadableStream<Uint8Array>({ start(value) {
                controller = value;
                if (provider === "anthropic") send({ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } });
                send(delta('{"result":{"type":"final","answer":"Hello'));
            } });
            return new Response(stream);
        }) as typeof fetch);
        const telemetry = new ConsoleTelemetry();
        const pending = new OpenKodeAgent(new TelemetryLLMProvider(cloud, telemetry), telemetry).run({ prompt: "hi", stream: true }, chunk => { visible += chunk; signal(); });
        try {
            await received;
            assert.equal(visible, "Hello");
            send(delta(' world"}}'));
            if (provider === "gemini") send({ candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } });
            else if (provider === "openai") send({ type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 2 } } });
            else { send({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }); send({ type: "message_stop" }); }
            controller.close();
            const result = await pending;
            assert.equal(visible, "Hello world"); assert.equal(result.response, visible);
            assert.equal(result.usage.inputTokens, 10); assert.equal(result.usage.outputTokens, 2);
        } catch (error) { controller?.error(error); await pending.catch(() => {}); throw error; }
    });
}

test("Ollama uses JSON streaming, handles a final line without newline, and retains usage", async context => {
    const raw = JSON.stringify({ type: "final", answer: "Hello 世界" });
    context.mock.method(globalThis, "fetch", async (_url, options) => {
        const body = JSON.parse(String(options!.body)); assert.equal(body.stream, true); assert.equal(body.format, "json");
        const bytes = new TextEncoder().encode(JSON.stringify({ message: { content: raw.slice(0, -3) }, done: false }) + "\n" + JSON.stringify({ message: { content: raw.slice(-3) }, done: true, prompt_eval_count: 9, eval_count: 3, total_duration: 1, prompt_eval_duration: 1, eval_duration: 1 }));
        return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } }));
    });
    let visible = "";
    const result = await new OpenKodeAgent(new OllamaProvider(), new ConsoleTelemetry()).run({ prompt: "hi", stream: true }, chunk => { visible += chunk; });
    assert.equal(visible, "Hello 世界"); assert.equal(result.response, visible); assert.equal(result.usage.inputTokens, 9);
});
