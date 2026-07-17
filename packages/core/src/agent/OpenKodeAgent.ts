import type { LLMProvider } from "../llm/interface/LLMProvider.js";
import type { LLMRequest } from "../llm/interface/LLMRequest.js";
import type { LLMUsage } from "../llm/interface/LLMUsage.js";
import type { AgentRequest } from "./interface/AgentRequest.js";
import type { AgentResponse } from "./interface/AgentResponse.js";

export class OpenKodeAgent {
    constructor(private readonly llm: LLMProvider) { }

    async run(agentRequest: AgentRequest): Promise<AgentResponse> {

        const llmrequest: LLMRequest = { prompt: agentRequest.prompt };

        //agentrequest => llmrequest transformation
        const response = await this.llm.generate(llmrequest);

        //llmresponse => agentresponse transformation
        const agentresponse: AgentResponse = { response: response.response };

        return agentresponse;
    }

    // packages/core/src/agent/OpenKodeAgent.ts
    async stream(prompt: string, onChunk: (text: string) => void): Promise<{usage: LLMUsage}> {
        return this.llm.stream({ prompt }, onChunk);
    }
}