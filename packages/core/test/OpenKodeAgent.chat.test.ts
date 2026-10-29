import assert from "node:assert/strict";
import test from "node:test";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import type { LLMProvider } from "../src/llm/interface/LLMProvider.js";
import type { TelemetryInterface, TelemetrySpanDetails } from "../src/telemetry/TelemetryInterface.js";

test("sends persisted chat history to orchestration and records the chat ID in run metadata", async () => {
    const requests: unknown[] = [];
    let runMetadata: TelemetrySpanDetails | undefined;
    const llm = {
        generateForOrchestrator: async (request: unknown) => {
            requests.push(request);
            return { type: "final", answer: "Remembered context." };
        },
    } as LLMProvider;
    const telemetry: TelemetryInterface = {
        async withRun(_name, operation, metadataFactory) {
            const result = await operation();
            runMetadata = metadataFactory?.(result);
            return result;
        },
        async withSpan(_type, _name, operation) {
            return operation();
        },
        async shutdown() {},
    };

    const agent = new OpenKodeAgent(llm, telemetry);
    await agent.run({
        prompt: "What did we decide?",
        chatId: "chat-123",
        history: [{ id: "turn-1", role: "user", content: "Use TypeScript.", createdAt: "2026-01-01T00:00:00.000Z" }],
    }, () => {});

    const request = requests[0] as { messages: Array<{ role: string; content: string }> };
    const background = JSON.parse(request.messages[1]!.content) as { backgroundConversation: Array<{ content: string }> };
    assert.equal(background.backgroundConversation[0]?.content, "Use TypeScript.");
    assert.equal(JSON.parse(request.messages.at(-1)!.content).request,"What did we decide?");
    assert.equal(runMetadata?.metadata?.chatId, "chat-123");
});
