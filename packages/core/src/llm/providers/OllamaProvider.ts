// Ollama Provider

import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMResponse } from "../interface/LLMResponse.js";
import type { LLMUsage } from "../interface/LLMUsage.js";

export class OllamaProvider implements LLMProvider {
    async generate(request: LLMRequest): Promise<LLMResponse> {
        const response = await fetch(
            "http://localhost:11434/api/chat",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "qwen2.5-coder:3b",
                    messages: request.messages,
                    stream: false
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Ollama request failed: ${await response.text()}`);
        }

        const data = await response.json();

        return {
            response: data.message.content
        };
    }

    async stream(request: LLMRequest, onChunk: (text: string) => void): Promise<{usage:LLMUsage}> {
        const response = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "qwen2.5-coder:3b",
                messages: request.messages,
                stream: true,
            }),
        });

        if (!response.ok || !response.body) {
            throw new Error(`Could not start Ollama stream: ${await response.text()}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        let usage: LLMUsage | undefined;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.trim()) continue;
                const chunk = JSON.parse(line) ;
                if (chunk.message?.content) onChunk(chunk.message.content);
                if(chunk.done){
                    usage = {
                        inputTokens: chunk.prompt_eval_count,
                        outputTokens: chunk.eval_count,
                        totalDurationNs: chunk.total_duration,
                        promptEvalDurationNs: chunk.prompt_eval_duration,
                        evalDurationNs: chunk.eval_duration,
                    };
                }
            }
        }

        if (!usage) {
            throw new Error("Ollama stream ended without usage data");
        }

        return { usage };
    }
}