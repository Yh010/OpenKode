import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
import { SpanType } from "../../telemetry/TelemetryEventInterface.js";
import type { TelemetryInterface } from "../../telemetry/TelemetryInterface.js";
import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMUsage } from "../interface/LLMUsage.js";
import { TelemetryPayloadPolicy } from "../../telemetry/TelemetryPayloadPolicy.js";
import { createCoderMessages, createPlannerMessages } from "../prompts/workerMessages.js";

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
            (response) => this.payloadPolicy.generationMetadata(telemetryInput, response),
        );
    }

    async generateForOrchestrator(request: LLMRequest) {
        return this.telemetry.withSpan("generation",SpanType.LLM_ORCHESTRATOR,
            () => this.provider.generateForOrchestrator(request),
            (response) => this.payloadPolicy.generationMetadata(request, response),
        );
    }

    async generateForCoder(request: OrchestratorResponse) {
        const telemetryInput = { messages: createCoderMessages(request) };
        return this.telemetry.withSpan("generation",SpanType.LLM_CODER,
            () => this.provider.generateForCoder(request),
            (response) => this.payloadPolicy.generationMetadata(telemetryInput, response),
        );
    }

    async generate(request: LLMRequest) {
        return this.telemetry.withSpan("generation",SpanType.LLM_GENERATE,
            () => this.provider.generate(request),
            (response) => this.payloadPolicy.generationMetadata(request, response),
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
                return this.payloadPolicy.generationMetadata(
                    request,
                    { response: output.value, usage: response.usage },
                    output.truncated,
                );
            },
        );
    }
}
