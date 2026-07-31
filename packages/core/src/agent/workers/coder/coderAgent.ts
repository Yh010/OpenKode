import type { LLMProvider } from "../../../llm/interface/LLMProvider.js";
import type { CoderResponse } from "../../interface/CoderResponsetypes.js";
import type { Delegate } from "../../interface/OrchestratorResponsetypes.js";
import type { PlannerResponse } from "../../interface/PlannerResponsetype.js";

export class CoderAgent{
    constructor(private readonly llm:LLMProvider){}

    async run(task:Delegate):Promise<CoderResponse> {
        const response: CoderResponse = await this.llm.generateForCoder(task);
        return response;
    }
}