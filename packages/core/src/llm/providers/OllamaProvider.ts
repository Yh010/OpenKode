// Ollama Provider

import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMResponse } from "../interface/LLMResponse.js";
import type { LLMUsage } from "../interface/LLMUsage.js";

export class OllamaProvider implements LLMProvider {
    async generate(request: LLMRequest): Promise<LLMResponse> {
        const response = await fetch(
            "http://localhost:11434/api/generate",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "qwen2.5-coder:3b",
                    prompt: request.prompt,
                    stream: false
                })
            }
        );

        const data = await response.json();

        return {
            response: data.response
        };
    }

    async stream(request: LLMRequest, onChunk: (text: string) => void): Promise<{usage:LLMUsage}> {
        const response = await fetch("http://localhost:11434/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "qwen2.5-coder:3b",
                prompt: request.prompt,
                stream: true,
            }),
        });


        if (!response.ok || !response.body) {
            throw new Error("Could not start Ollama stream");
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
                if (chunk.response) onChunk(chunk.response);
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