// Ollama Provider

import type { CoderResponse } from "../../agent/interface/CoderResponsetypes.js";
import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
import type { PlannerResponse } from "../../agent/interface/PlannerResponsetype.js";
import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMResponse } from "../interface/LLMResponse.js";
import type { LLMUsage } from "../interface/LLMUsage.js";
import type { Message } from "../../agent/interface/Message.js";
import { createCoderMessages, createPlannerMessages } from "../prompts/workerMessages.js";

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

    //TODO: IMPORTANT: Model should not know what is the response for (orchestrator | planner | coder) => it should only know about llm interface

    async generateForPlanner(request: OrchestratorResponse): Promise<PlannerResponse> {

        return this.chatForJson<PlannerResponse>("planner", createPlannerMessages(request));
    }

    async generateForCoder(request: OrchestratorResponse): Promise<CoderResponse> {

        return this.chatForJson<CoderResponse>("coder", createCoderMessages(request));
    }

    async generateForOrchestrator(request: LLMRequest): Promise<OrchestratorResponse> {
        return this.chatForJson<OrchestratorResponse>("orchestrator", request.messages);
    }

    private async chatForJson<T>(role: string, messages: Message[]): Promise<T> {
        console.log(`[OpenKode][${role}] Calling Ollama with ${messages.length} message(s).`);
        const response = await fetch(
            "http://localhost:11434/api/chat",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "qwen2.5-coder:3b",
                    messages,
                    stream: false,
                    format: "json",
                })
            }
        );

        if (!response.ok) {
            const body = await response.text();
            console.error(`[OpenKode][${role}] Ollama returned HTTP ${response.status}.`, body);
            throw new Error(`Ollama ${role} request failed: ${body}`);
        }

        const data = await response.json();
        const content = data.message?.content;
        if (typeof content !== "string") {
            console.error(`[OpenKode][${role}] Ollama response did not contain message.content.`, data);
            throw new Error(`Ollama ${role} response did not contain message.content`);
        }

        try {
            const result = JSON.parse(stripJsonCodeFence(content)) as T;
            console.log(`[OpenKode][${role}] Received valid JSON response.`);
            return result;
        } catch (error) {
            console.error(`[OpenKode][${role}] Expected JSON but received:`, content);
            throw new Error(
                `Ollama ${role} response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
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

function stripJsonCodeFence(content: string): string {
    const trimmed = content.trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1]! : trimmed;
}
