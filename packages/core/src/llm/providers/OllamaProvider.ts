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
import { coderResponseSchema } from "./coderResponseSchema.js";
import { decisionStream } from "../DecisionStream.js";
import { recordModelUsage } from "../usage.js";
import { captureModelText, captureModelUsage } from "../../telemetry/ModelCallCapture.js";

export class OllamaProvider implements LLMProvider {
    readonly info: { provider: string; model: string };
    constructor(private readonly model = "qwen2.5-coder:3b") { this.info = { provider: "ollama", model }; }
    async generate(request: LLMRequest): Promise<LLMResponse> {
        const response = await fetch(
            "http://localhost:11434/api/chat",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: this.model,
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
        const output = decisionStream(role, false);
        if (output) {
            let content = "";
            const { usage } = await this.streamChat({ messages: [...messages, { role: "system", content: "For research_result, emit sources before answer." }] }, chunk => { content += chunk; output.append(chunk); }, "json");
            let result: T;
            try { result = JSON.parse(stripJsonCodeFence(content)) as T; } catch { throw new Error(`Ollama ${role} response was not valid JSON. Retry the request.`); }
            output.finish(result);
            Object.defineProperty(result, "usage", { value: usage, enumerable: false });
            return result;
        }
        const response = await fetch(
            "http://localhost:11434/api/chat",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    stream: false,
                    format: role === "coder" ? coderResponseSchema : "json",
                })
            }
        );

        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw new Error(`Ollama ${role} request failed (HTTP ${response.status}). Check Ollama and the configured model.`);
        }

        const data = await response.json();
        const content = data.message?.content;
        if (typeof content === "string") captureModelText(content);
        if (typeof content !== "string") {
            throw new Error(`Ollama ${role} response did not contain message.content`);
        }

        try {
            const result = JSON.parse(stripJsonCodeFence(content)) as T;
            return result;
        } catch (error) {
            throw new Error(
                `Ollama ${role} response was not valid JSON. Retry the request.`,
            );
        }
    }

    async stream(request: LLMRequest, onChunk: (text: string) => void): Promise<{usage:LLMUsage}> {
        return this.streamChat(request, onChunk);
    }
    private async streamChat(request: LLMRequest, onChunk: (text: string) => void, format?: string): Promise<{usage:LLMUsage}> {
        const response = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: this.model,
                messages: request.messages,
                stream: true,
                ...(format ? { format } : {}),
            }),
        });

        if (!response.ok || !response.body) {
            await response.body?.cancel().catch(() => {});
            throw new Error(`Could not start Ollama stream (HTTP ${response.status}).`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        let usage: LLMUsage | undefined;

        try { while (true) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            if (done && buffer.trim()) { lines.push(buffer); buffer = ""; }

            for (const line of lines) {
                if (!line.trim()) continue;
                let chunk;
                try { chunk = JSON.parse(line); } catch { throw new Error("Ollama returned an invalid stream event."); }
                if (chunk.error) throw new Error("Ollama could not finish the stream.");
                if (typeof chunk.message?.content === "string") { captureModelText(chunk.message.content); onChunk(chunk.message.content); }
                if(chunk.done){
                    usage = {
                        inputTokens: chunk.prompt_eval_count,
                        outputTokens: chunk.eval_count,
                        totalDurationNs: chunk.total_duration ?? 0,
                        promptEvalDurationNs: chunk.prompt_eval_duration ?? 0,
                        evalDurationNs: chunk.eval_duration ?? 0,
                    };
                    captureModelUsage(usage);
                }
            }
            if (done) break;
        } } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }

        if (!usage || !Object.values(usage).every(value => Number.isFinite(value) && value >= 0)) {
            throw new Error("Ollama stream ended without usage data");
        }

        recordModelUsage(usage);
        return { usage };
    }
}

function stripJsonCodeFence(content: string): string {
    const trimmed = content.trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1]! : trimmed;
}
