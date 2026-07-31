import type { LLMProvider } from "../../../llm/interface/LLMProvider.js";
import type { Delegate } from "../../interface/OrchestratorResponsetypes.js";
import type { PlannerResponse } from "../../interface/PlannerResponsetype.js";

export class PlannerAgent{
    constructor(private readonly llm:LLMProvider){}

    async run(task:Delegate):Promise<PlannerResponse> {
        const response: PlannerResponse = await this.llm.generateForPlanner(task);
        return response;
    }
}