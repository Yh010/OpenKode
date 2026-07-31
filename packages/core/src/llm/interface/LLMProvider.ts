import type { CoderResponse } from "../../agent/interface/CoderResponsetypes.js";
import type { OrchestratorResponse } from "../../agent/interface/OrchestratorResponsetypes.js";
import type { PlannerResponse } from "../../agent/interface/PlannerResponsetype.js";
import type { LLMRequest } from "./LLMRequest.js";
import type { LLMResponse } from "./LLMResponse.js";
import type { LLMUsage } from "./LLMUsage.js";

export interface LLMProvider {
    generate(request: LLMRequest): Promise<LLMResponse>;
    stream(request: LLMRequest,onChunk:(text:string)=>void): Promise<{usage: LLMUsage}>;
    generateForPlanner(request: OrchestratorResponse): Promise<PlannerResponse>; //TODO: Fix the type
    generateForOrchestrator(request: any): Promise<OrchestratorResponse>;
    generateForCoder(request: OrchestratorResponse): Promise<CoderResponse> ;
}