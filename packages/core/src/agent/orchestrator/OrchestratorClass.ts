import type { LLMProvider } from "../../llm/interface/LLMProvider.js";
import type { LLMRequest } from "../../llm/interface/LLMRequest.js";
import type { OrchestratorResponse } from "../interface/OrchestratorResponsetypes.js";

export class Orchestrator{
    constructor(private readonly llm: LLMProvider){}


    async run(request: LLMRequest): Promise<OrchestratorResponse> {
        return this.llm.generateForOrchestrator(request);
    }

}
