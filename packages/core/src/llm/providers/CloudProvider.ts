import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMUsage } from "../interface/LLMUsage.js";
import type { Message } from "../../agent/interface/Message.js";
import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
import type { PlannerResponse } from "../../agent/interface/PlannerResponsetype.js";
import type { CoderResponse } from "../../agent/interface/CoderResponsetypes.js";
import { createCoderMessages, createPlannerMessages } from "../prompts/workerMessages.js";
import { decisionSchema, parseDecision, type DecisionRole } from "./responseSchemas.js";
import { recordModelUsage } from "../usage.js";

export type CloudProviderOptions = { provider: "openai" | "anthropic"; model: string; apiKey: string };
type Result = { text: string; usage: LLMUsage };
type Json = Record<string, any>;

export class CloudProvider implements LLMProvider {
    readonly info: { provider: string; model: string };
    constructor(private readonly options: CloudProviderOptions, private readonly request: typeof fetch = fetch) {
        if (!["openai", "anthropic"].includes(options.provider) || !options.model.trim() || !options.apiKey.trim() || /\s/.test(options.apiKey)) throw new Error("A provider, model and valid API key are required. Run openkode configure.");
        this.info = { provider: options.provider, model: options.model };
    }
    async generate(request: LLMRequest) { const result = await this.complete(request.messages); return { response: result.text, usage: result.usage }; }
    async generateForPlanner(request: OrchestratorResponse): Promise<PlannerResponse> { return this.decide("planner", createPlannerMessages(request)); }
    async generateForCoder(request: OrchestratorResponse): Promise<CoderResponse> { return this.decide("coder", createCoderMessages(request)); }
    async generateForOrchestrator(request: LLMRequest): Promise<OrchestratorResponse> { return this.decide("orchestrator", request.messages); }
    private async decide<T>(role: DecisionRole, messages: Message[]): Promise<T> {
        const result = await this.complete([...messages, { role: "system", content: "Wire format: return a JSON object with exactly one key, result, containing the decision required by the instructions. The runtime removes this wrapper before using your decision." }], role);
        const decision = parseDecision<T>(result.text);
        // Usage stays outside the model's decision fields and is not serialized
        // into subsequent prompts; telemetry and the CLI can still read it.
        Object.defineProperty(decision, "usage", { value: result.usage, enumerable: false });
        return decision;
    }
    private async start(messages: Message[], stream: boolean, role?: DecisionRole): Promise<Response> {
        const openai = this.options.provider === "openai";
        const schema = role ? decisionSchema(role) : undefined;
        const body = openai ? {
            model: this.options.model, input: messages, store: false, stream,
            max_output_tokens: 8192,
            ...(schema ? { text: { format: { type: "json_schema", name: `${role}_decision`, strict: true, schema } } } : {}),
        } : {
            model: this.options.model, max_tokens: 8192, stream,
            system: messages.filter(message => message.role === "system").map(message => message.content).join("\n\n"),
            messages: messages.filter(message => message.role !== "system"),
            ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {}),
        };
        let response: Response;
        try {
            response = await this.request(openai ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages", {
                method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.apiKey}`,
                    ...(openai ? {} : { "anthropic-version": "2026-10-21" }) },
                body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(180_000),
            });
        } catch { throw new Error(`${this.info.provider} could not be reached. Check your connection and retry.`); }
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            const help = response.status === 401 || response.status === 403 ? "Check your API key and model access with openkode configure."
                : response.status === 429 ? "Check your provider quota or rate limit, then retry." : "Check the model ID and provider status, then retry.";
            throw new Error(`${this.info.provider} request failed (HTTP ${response.status}). ${help}`);
        }
        return response;
    }
    private async complete(messages: Message[], role?: DecisionRole): Promise<Result> {
        const started = performance.now();
        const response = await this.start(messages, false, role);
        let data: Json;
        try { data = await response.json() as Json; } catch { throw new Error("The provider returned an invalid response."); }
        const openai = this.options.provider === "openai";
        if (!data || typeof data !== "object") throw new Error("The provider returned an invalid response.");
        if (openai ? data.status !== "completed" : data.stop_reason !== "end_turn") throw new Error("The model did not finish its answer. Retry or choose a model with a larger output allowance.");
        if (!Array.isArray(openai ? data.output : data.content)) throw new Error("The provider returned an invalid response.");
        const blocks = openai ? data.output.filter((item: Json) => item?.type === "message").flatMap((item: Json) => Array.isArray(item.content) ? item.content : []) : data.content;
        if (blocks.some((block: Json) => block?.type === "refusal")) throw new Error("The model declined this request.");
        const text = blocks.filter((block: Json) => block?.type === (openai ? "output_text" : "text") && typeof block.text === "string").map((block: Json) => block.text).join("");
        if (!text || typeof text !== "string") throw new Error("The provider returned no text.");
        const usage = usageFrom(data.usage, performance.now() - started);
        recordModelUsage(usage);
        return { text, usage };
    }
    async stream(request: LLMRequest, onChunk: (text: string) => void): Promise<{ usage: LLMUsage }> {
        const started = performance.now();
        const response = await this.start(request.messages, true);
        let usage: LLMUsage | undefined;
        let finished = false;
        for await (const event of sse(response)) {
            if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw new Error("The provider could not finish the stream. Retry the request.");
            if (event.type === "response.output_text.delta" && typeof event.delta === "string") onChunk(event.delta);
            if (event.type === "response.refusal.delta") throw new Error("The model declined this request.");
            if (event.type === "response.completed") { usage = usageFrom(event.response?.usage, performance.now() - started); finished = true; }
            if (event.type === "message_start") usage = usageFrom(event.message?.usage, 0);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") onChunk(event.delta.text);
            if (event.type === "message_delta") {
                if (event.delta?.stop_reason && event.delta.stop_reason !== "end_turn") throw new Error("The model did not finish its answer.");
                if (usage && typeof event.usage?.output_tokens === "number") usage.outputTokens = event.usage.output_tokens;
            }
            if (event.type === "message_stop") finished = true;
        }
        if (!finished || !usage) throw new Error("The provider stream ended before completion.");
        usage.totalDurationNs = Math.round((performance.now() - started) * 1_000_000);
        recordModelUsage(usage);
        return { usage };
    }
}

function usageFrom(value: Json | undefined, durationMs: number): LLMUsage {
    if (!value || ![value.input_tokens, value.output_tokens].every(token => Number.isFinite(token) && token >= 0)) throw new Error("The provider did not return valid token usage.");
    const cached = [value.cache_creation_input_tokens ?? 0, value.cache_read_input_tokens ?? 0];
    if (!cached.every(token => Number.isFinite(token) && token >= 0)) throw new Error("The provider did not return valid cached token usage.");
    return { inputTokens: value.input_tokens + cached[0] + cached[1], outputTokens: value.output_tokens, totalDurationNs: Math.round(durationMs * 1_000_000), promptEvalDurationNs: 0, evalDurationNs: 0 };
}

async function* sse(response: Response): AsyncGenerator<Json> {
    if (!response.body) throw new Error("The provider returned no stream.");
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? "";
            if (done && buffer.trim()) { frames.push(buffer); buffer = ""; }
            for (const frame of frames) {
                const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
                if (!data || data === "[DONE]") continue;
                try { yield JSON.parse(data); } catch { throw new Error("The provider returned an invalid stream event."); }
            }
            if (buffer.length > 2_000_000) throw new Error("The provider stream event was too large.");
            if (done) break;
        }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
