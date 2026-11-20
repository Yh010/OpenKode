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
import { reportAgentProgress } from "../../agent/AgentProgress.js";
import { decisionStream } from "../DecisionStream.js";

export type CloudProviderOptions = { provider: "openai" | "anthropic" | "gemini"; model: string; apiKey: string };
type Result = { text: string; usage: LLMUsage };
type Json = Record<string, any>;
const MAX_RETRIES = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const retryTiming = { wait: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), random: () => Math.random() };

export class CloudProvider implements LLMProvider {
    readonly info: { provider: string; model: string };
    constructor(private readonly options: CloudProviderOptions, private readonly request: typeof fetch = fetch, private readonly timing = retryTiming) {
        if (!["openai", "anthropic", "gemini"].includes(options.provider) || !options.model.trim() || !options.apiKey.trim() || /\s/.test(options.apiKey)) throw new Error("A provider, model and valid API key are required. Run openkode configure.");
        this.info = { provider: options.provider, model: options.model };
    }
    async generate(request: LLMRequest) { const result = await this.complete(request.messages); return { response: result.text, usage: result.usage }; }
    async generateForPlanner(request: OrchestratorResponse): Promise<PlannerResponse> { return this.decide("planner", createPlannerMessages(request)); }
    async generateForCoder(request: OrchestratorResponse): Promise<CoderResponse> { return this.decide("coder", createCoderMessages(request)); }
    async generateForOrchestrator(request: LLMRequest): Promise<OrchestratorResponse> { return this.decide("orchestrator", request.messages); }
    private async decide<T>(role: DecisionRole, messages: Message[]): Promise<T> {
        const input: Message[] = [...messages, { role: "system", content: "Wire format: return a JSON object with exactly one key, result, containing the decision required by the instructions. The runtime removes this wrapper before using your decision. For a research_result, emit sources before answer." }];
        const output = decisionStream(role, true);
        let result: Result;
        if (output) {
            let text = "";
            const { usage } = await this.streamMessages(input, chunk => { text += chunk; output.append(chunk); }, role);
            result = { text, usage };
        } else result = await this.complete(input, role);
        const decision = parseDecision<T>(result.text);
        output?.finish(decision);
        // Usage stays outside the model's decision fields and is not serialized
        // into subsequent prompts; telemetry and the CLI can still read it.
        Object.defineProperty(decision, "usage", { value: result.usage, enumerable: false });
        return decision;
    }
    private async start(messages: Message[], stream: boolean, role?: DecisionRole): Promise<Response> {
        const openai = this.options.provider === "openai";
        const gemini = this.options.provider === "gemini";
        const schema = role ? decisionSchema(role) : undefined;
        const systemParts = messages.filter(message => message.role === "system").map(message => ({ text: message.content }));
        const body = gemini ? {
            ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
            contents: messages.filter(message => message.role !== "system").map(message => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
            generationConfig: { maxOutputTokens: 8192, ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}) },
        } : openai ? {
            model: this.options.model, input: messages, store: false, stream,
            max_output_tokens: 8192,
            ...(schema ? { text: { format: { type: "json_schema", name: `${role}_decision`, strict: true, schema } } } : {}),
        } : {
            model: this.options.model, max_tokens: 8192, stream,
            system: messages.filter(message => message.role === "system").map(message => message.content).join("\n\n"),
            messages: messages.filter(message => message.role !== "system"),
            ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {}),
        };
        const url = gemini ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.options.model.replace(/^models\//, ""))}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`
            : openai ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages";
        const label = { openai: "OpenAI", anthropic: "Claude", gemini: "Gemini" }[this.options.provider];
        const serialized = JSON.stringify(body);
        // Retry only the model HTTP request. Never replay tools or an accepted stream.
        for (let attempt = 0; ; attempt++) {
            let response: Response;
            try {
                response = await this.request(url, {
                    method: "POST", headers: { "Content-Type": "application/json",
                        ...(gemini ? { "x-goog-api-key": this.options.apiKey } : { Authorization: `Bearer ${this.options.apiKey}` }),
                        ...(this.options.provider === "anthropic" ? { "anthropic-version": "2026-10-21" } : {}) },
                    body: serialized, redirect: "error", signal: AbortSignal.timeout(180_000),
                });
            } catch {
                // A network failure may occur after the provider accepted the request;
                // leave that ambiguous case to the user rather than duplicate it.
                throw new Error(`${label} could not be reached. Check your connection and retry.`);
            }
            if (response.ok) return response;
            await response.body?.cancel().catch(() => {});
            const retryAfter = retryAfterMs(response.headers.get("retry-after"));
            if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES && retryAfter <= 30_000) {
                const delay = Math.max(retryAfter, 1000 * 2 ** attempt + Math.floor(this.timing.random() * 250));
                const reason = response.status === 429 ? "is rate limited" : response.status === 408 ? "timed out" : "is temporarily unavailable";
                reportAgentProgress({ kind: "status", message: `${label} ${reason}. Retrying in ${Math.ceil(delay / 1000)} seconds · retry ${attempt + 1}/${MAX_RETRIES}` });
                await this.timing.wait(delay);
                reportAgentProgress({ kind: "status", message: `Waiting for ${label} · retry ${attempt + 1}/${MAX_RETRIES}` });
                continue;
            }
            const retried = attempt ? ` after ${attempt} ${attempt === 1 ? "retry" : "retries"}` : "";
            if (response.status >= 500 && RETRYABLE_STATUS.has(response.status)) {
                throw new Error(`${label} is temporarily unavailable (HTTP ${response.status})${retried}. Please try again later.`);
            }
            if (response.status === 408) throw new Error(`${label} timed out (HTTP 408)${retried}. Please try again later.`);
            const help = response.status === 401 || response.status === 403 ? "Check your API key and model access with openkode configure."
                : response.status === 429 ? "Check your provider quota or rate limit, then try again later." : "Check the model ID and provider status, then retry.";
            throw new Error(`${label} request failed (HTTP ${response.status})${retried}. ${help}`);
        }
    }
    private async complete(messages: Message[], role?: DecisionRole): Promise<Result> {
        const started = performance.now();
        const response = await this.start(messages, false, role);
        let data: Json;
        try { data = await response.json() as Json; } catch { throw new Error("The provider returned an invalid response."); }
        const openai = this.options.provider === "openai";
        if (!data || typeof data !== "object") throw new Error("The provider returned an invalid response.");
        if (this.options.provider === "gemini") {
            const candidate = geminiCandidate(data);
            if (candidate?.finishReason !== "STOP") throw new Error("The model did not finish its answer. Retry or choose a model with a larger output allowance.");
            const text = geminiText(candidate);
            if (!text) throw new Error("The provider returned no text.");
            const usage = geminiUsage(data.usageMetadata, performance.now() - started);
            recordModelUsage(usage);
            return { text, usage };
        }
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
        return this.streamMessages(request.messages, onChunk);
    }
    private async streamMessages(messages: Message[], onChunk: (text: string) => void, role?: DecisionRole): Promise<{ usage: LLMUsage }> {
        const started = performance.now();
        const response = await this.start(messages, true, role);
        let usage: LLMUsage | undefined;
        let geminiMetadata: Json | undefined;
        let finished = false;
        for await (const event of sse(response)) {
            if (this.options.provider === "gemini") {
                if (finished && event.candidates?.length) throw new Error("The provider sent content after stream completion.");
                const candidate = geminiCandidate(event);
                if (candidate?.finishReason && candidate.finishReason !== "STOP") throw new Error("The model did not finish its answer.");
                const text = geminiText(candidate);
                if (text) onChunk(text);
                // Early chunks may report only prompt usage; final metadata is cumulative.
                if (event.usageMetadata) geminiMetadata = event.usageMetadata;
                if (candidate?.finishReason === "STOP") finished = true;
                continue;
            }
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
        if (this.options.provider === "gemini" && finished && geminiMetadata) usage = geminiUsage(geminiMetadata, 0);
        if (!finished || !usage) throw new Error("The provider stream ended before completion.");
        usage.totalDurationNs = Math.round((performance.now() - started) * 1_000_000);
        recordModelUsage(usage);
        return { usage };
    }
}

function retryAfterMs(value: string | null): number {
    if (!value?.trim()) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function geminiCandidate(data: Json): Json | undefined {
    if (!data || typeof data !== "object" || data.error) throw new Error("The provider returned an invalid response.");
    if (data.promptFeedback?.blockReason) throw new Error("The model declined this request.");
    if (data.candidates !== undefined && (!Array.isArray(data.candidates) || data.candidates.length > 1)) throw new Error("The provider returned an invalid response.");
    const candidate = data.candidates?.[0];
    if (candidate !== undefined && (!candidate || typeof candidate !== "object")) throw new Error("The provider returned an invalid response.");
    return candidate;
}

function geminiText(candidate: Json | undefined): string {
    const parts = candidate?.content?.parts;
    if (parts === undefined) return "";
    if (!Array.isArray(parts)) throw new Error("The provider returned an invalid response.");
    return parts.filter((part: Json) => part && !part.thought && typeof part.text === "string").map((part: Json) => part.text).join("");
}

function geminiUsage(value: Json | undefined, durationMs: number): LLMUsage {
    if (!value || ![value.promptTokenCount, value.candidatesTokenCount, value.thoughtsTokenCount ?? 0].every(token => Number.isFinite(token) && token >= 0)) throw new Error("The provider did not return valid token usage.");
    // Prompt totals already include cached tokens; thinking tokens are output.
    return { inputTokens: value.promptTokenCount, outputTokens: value.candidatesTokenCount + (value.thoughtsTokenCount ?? 0), totalDurationNs: Math.round(durationMs * 1_000_000), promptEvalDurationNs: 0, evalDurationNs: 0 };
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
