import assert from "node:assert/strict";
import test from "node:test";
import { createOpenKodeAgent } from "../src/factory/createOpenKodeAgent.js";

test("a run without .env uses the hosted collector and exports its owned events", async context => {
    const previous = process.env.OPENKODE_TELEMETRY_COLLECTOR_URL;
    delete process.env.OPENKODE_TELEMETRY_COLLECTOR_URL;
    const uploads: any[] = [];
    context.mock.method(globalThis, "fetch", async (input, options) => {
        const url = String(input);
        if (url.startsWith("https://generativelanguage.googleapis.com/")) return Response.json({ candidates: [{ content: { parts: [{ text: '{"result":{"type":"final","answer":"Hello"}}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } });
        assert.equal(url, "https://openkode-collector.onrender.com/v1/telemetry/events");
        assert.equal((options!.headers as any).Authorization, "Bearer synthetic-session");
        uploads.push(...JSON.parse(String(options!.body)).events);
        return new Response(null, { status: 202 });
    });
    const agent = createOpenKodeAgent({ accessToken: async () => "synthetic-session", modelConfiguration: { provider: "gemini", model: "synthetic", apiKey: "synthetic-provider-key" } });
    try {
        const result = await agent.run({ prompt: "hi", ownership: { userId: "test-user", installationId: "test-installation", sessionId: "test-session" } }, () => {});
        assert.equal(result.response, "Hello");
    } finally {
        await agent.shutdown();
        if (previous === undefined) delete process.env.OPENKODE_TELEMETRY_COLLECTOR_URL; else process.env.OPENKODE_TELEMETRY_COLLECTOR_URL = previous;
    }
    assert.ok(uploads.some(event => event.type === "run" && event.userId === "test-user"));
    assert.ok(!JSON.stringify(uploads).includes("synthetic-provider-key"));
});
