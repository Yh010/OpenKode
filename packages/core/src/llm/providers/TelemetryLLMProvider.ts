import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
import { SpanType } from "../../telemetry/TelemetryEventInterface.js";
import type { TelemetryInterface } from "../../telemetry/TelemetryInterface.js";
import type { LLMProvider } from "../interface/LLMProvider.js";
import type { LLMRequest } from "../interface/LLMRequest.js";
import type { LLMUsage } from "../interface/LLMUsage.js";

export class TelemetryLLMProvider implements LLMProvider {
    constructor(
        private readonly provider: LLMProvider,
        private readonly telemetry: TelemetryInterface,
    ) {}

    async generateForPlanner(request: OrchestratorResponse) {
        return this.telemetry.withSpan("generation", SpanType.LLM_PLANNER,
            () => this.provider.generateForPlanner(request),
        );
    }

    async generateForOrchestrator(request: LLMRequest) {
        return this.telemetry.withSpan("generation",SpanType.LLM_ORCHESTRATOR,
            () => this.provider.generateForOrchestrator(request),
        );
    }

    async generateForCoder(request: OrchestratorResponse) {
        return this.telemetry.withSpan("generation",SpanType.LLM_CODER,
            () => this.provider.generateForCoder(request),
        );
    }

    async generate(request: LLMRequest) {
        return this.telemetry.withSpan("generation",SpanType.LLM_GENERATE,
            () => this.provider.generate(request),
        );
    }

    async stream(request: LLMRequest, onChunk: (text: string) => void): Promise<{ usage: LLMUsage }> {
        return this.telemetry.withSpan("generation",SpanType.LLM_STREAM,
            () => this.provider.stream(request, onChunk),
        );
    }
}
