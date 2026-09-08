import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
import { SpanType } from "../../telemetry/TelemetryEventInterface.js";
import type { TelemetryInterface } from "../../telemetry/TelemetryInterface.js";
import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMUsage } from "../interface/LLMUsage.js";
import { TelemetryPayloadPolicy } from "../../telemetry/TelemetryPayloadPolicy.js";
import { createCoderMessages, createPlannerMessages } from "../prompts/workerMessages.js";
import type { LlmTelemetry } from "../../telemetry/TelemetryEventInterface.js";

export class TelemetryLLMProvider implements LLMProvider {
    constructor(
        private readonly provider: LLMProvider,
        private readonly telemetry: TelemetryInterface,
        private readonly payloadPolicy = TelemetryPayloadPolicy.fromEnvironment(),
    ) {}

    async generateForPlanner(request: OrchestratorResponse) {
        const telemetryInput = { messages: createPlannerMessages(request) };
        return this.telemetry.withSpan("generation", SpanType.LLM_PLANNER,
            () => this.provider.generateForPlanner(request),
            (response) => this.generationDetails(telemetryInput, response),
        );
    }

    async generateForOrchestrator(request: LLMRequest) {
        return this.telemetry.withSpan("generation",SpanType.LLM_ORCHESTRATOR,
            () => this.provider.generateForOrchestrator(request),
            (response) => this.generationDetails(request, response),
        );
    }

    async generateForCoder(request: OrchestratorResponse) {
        const telemetryInput = { messages: createCoderMessages(request) };
        return this.telemetry.withSpan("generation",SpanType.LLM_CODER,
            () => this.provider.generateForCoder(request),
            (response) => this.generationDetails(telemetryInput, response),
        );
    }

    async generate(request: LLMRequest) {
        return this.telemetry.withSpan("generation",SpanType.LLM_GENERATE,
            () => this.provider.generate(request),
            (response) => this.generationDetails(request, response),
        );
    }

    async stream(request: LLMRequest, onChunk: (text: string) => void): Promise<{ usage: LLMUsage }> {
        const streamCapture = this.payloadPolicy.createStreamCapture();
        return this.telemetry.withSpan("generation",SpanType.LLM_STREAM,
            () => this.provider.stream(request, (text) => {
                streamCapture.append(text);
                onChunk(text);
            }),
            (response) => {
                const output = streamCapture.getValue();
                return this.generationDetails(
                    request,
                    { response: output.value, usage: response.usage },
                    output.truncated,
                );
            },
        );
    }

    private generationDetails(input: { messages: { role: string; content: string }[] }, output: unknown, streamOutputTruncated = false) {
        const metadata = this.payloadPolicy.generationMetadata(input, output, streamOutputTruncated);
        const usage = extractUsage(output);
        const llm: LlmTelemetry = {
            provider: "ollama",
            model: "qwen2.5-coder:3b",
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
