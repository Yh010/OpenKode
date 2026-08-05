import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
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
        return this.telemetry.withSpan(
            "llm.planner",
            () => this.provider.generateForPlanner(request),
        );
    }

    async generateForOrchestrator(request: LLMRequest) {
        return this.telemetry.withSpan(
            "llm.orchestrator",
            () => this.provider.generateForOrchestrator(request),
        );
    }

    async generateForCoder(request: OrchestratorResponse) {
        return this.telemetry.withSpan(
            "llm.coder",
            () => this.provider.generateForCoder(request),
        );
    }

    async generate(request: LLMRequest) {
        return this.telemetry.withSpan(
            "llm.generate",
            () => this.provider.generate(request),
        );
    }

    async stream(request: LLMRequest, onChunk: (text: string) => void): Promise<{ usage: LLMUsage }> {
        return this.telemetry.withSpan(
            "llm.stream",
            () => this.provider.stream(request, onChunk),
        );
    }
}
