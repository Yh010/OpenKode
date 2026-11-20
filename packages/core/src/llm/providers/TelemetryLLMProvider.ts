import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
import { SpanType } from "../../telemetry/TelemetryEventInterface.js";
import type { TelemetryInterface } from "../../telemetry/TelemetryInterface.js";
import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMUsage } from "../interface/LLMUsage.js";
import { TelemetryPayloadPolicy } from "../../telemetry/TelemetryPayloadPolicy.js";
import { createCoderMessages, createPlannerMessages } from "../prompts/workerMessages.js";
import { ModelCallCapture } from "../../telemetry/ModelCallCapture.js";
import type { LlmTelemetry } from "../../telemetry/TelemetryEventInterface.js";

export class TelemetryLLMProvider implements LLMProvider {
    get info() { return { provider: this.provider.info?.provider ?? "unknown", model: this.provider.info?.model ?? "unknown" }; }
    constructor(
        private readonly provider: LLMProvider,
        private readonly telemetry: TelemetryInterface,
        private readonly payloadPolicy = TelemetryPayloadPolicy.fromEnvironment(),
    ) {}

    async generateForPlanner(request: OrchestratorResponse) {
        const telemetryInput = { messages: createPlannerMessages(request) };
        return this.observe(SpanType.LLM_PLANNER, telemetryInput, () => this.provider.generateForPlanner(request));
    }

    async generateForOrchestrator(request: LLMRequest) {
        return this.observe(SpanType.LLM_ORCHESTRATOR, request, () => this.provider.generateForOrchestrator(request));
    }

    async generateForCoder(request: OrchestratorResponse) {
        const telemetryInput = { messages: createCoderMessages(request) };
        return this.observe(SpanType.LLM_CODER, telemetryInput, () => this.provider.generateForCoder(request));
    }

    async generate(request: LLMRequest) {
        return this.observe(SpanType.LLM_GENERATE, request, () => this.provider.generate(request));
    }

    async stream(request: LLMRequest, onChunk: (text: string) => void): Promise<{ usage: LLMUsage }> {
        const streamCapture = this.payloadPolicy.createStreamCapture();
        return this.observe(SpanType.LLM_STREAM, request, () => this.provider.stream(request, text => {
            streamCapture.append(text);
            onChunk(text);
        }), () => streamCapture.getValue());
    }

    private observe<T>(name: typeof SpanType[keyof typeof SpanType], input: LLMRequest, operation: () => Promise<T>, streamed?: () => { value: string; truncated: boolean }): Promise<T> {
        const capture = new ModelCallCapture(this.payloadPolicy);
        return this.telemetry.withSpan("generation", name, () => capture.run(operation), result => {
            const output = streamed?.();
            const details = this.generationDetails(input, output ? { response: output.value, ...(result as object) } : result, output?.truncated);
            return { ...details, metadata: { ...details.metadata, ...(capture.attempts.length ? { attempts: capture.attempts } : {}) } };
        }, error => {
            const recorded = capture.output.getValue();
            const output = recorded.value ? recorded : streamed?.() ?? recorded;
            const message = error instanceof Error ? error.message : String(error);
            const details = this.generationDetails(input, { error: message, partialOutput: output.value, ...(capture.usage ? { usage: capture.usage } : {}) }, output.truncated);
            return { ...details, metadata: { ...details.metadata, incomplete: true, partialOutputAvailable: Boolean(output.value),
                ...(capture.usage ? { usageIncomplete: true } : {}), ...(capture.attempts.length ? { attempts: capture.attempts } : {}) } };
        });
    }

    private generationDetails(input: { messages: { role: string; content: string }[] }, output: unknown, streamOutputTruncated = false) {
        const metadata = this.payloadPolicy.generationMetadata(input, output, streamOutputTruncated);
        const usage = extractUsage(output);
        const llm: LlmTelemetry = {
            ...this.info,
            ...(usage ? usage : {}),
        };
        return { ...(metadata ? { metadata } : {}), llm };
    }
}

function extractUsage(value: unknown): Omit<LlmTelemetry, "provider" | "model"> | undefined {
    if (typeof value !== "object" || value === null || !("usage" in value)) return undefined;
    const usage = value.usage;
    if (typeof usage !== "object" || usage === null) return undefined;
    const candidate = usage as Record<string, unknown>;
    const numeric = (key: string) => typeof candidate[key] === "number" ? candidate[key] : undefined;
    const details: Omit<LlmTelemetry, "provider" | "model"> = {};
    const inputTokens = numeric("inputTokens");
    const outputTokens = numeric("outputTokens");
    const totalDurationNs = numeric("totalDurationNs");
    const promptEvalDurationNs = numeric("promptEvalDurationNs");
    const evalDurationNs = numeric("evalDurationNs");
    if (inputTokens !== undefined) details.inputTokens = inputTokens;
    if (outputTokens !== undefined) details.outputTokens = outputTokens;
    if (totalDurationNs !== undefined) details.totalDurationNs = totalDurationNs;
    if (promptEvalDurationNs !== undefined) details.promptEvalDurationNs = promptEvalDurationNs;
    if (evalDurationNs !== undefined) details.evalDurationNs = evalDurationNs;
    return Object.keys(details).length ? details : undefined;
}
