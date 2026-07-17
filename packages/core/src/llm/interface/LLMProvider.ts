import type { LLMRequest } from "./LLMRequest.js";
import type { LLMResponse } from "./LLMResponse.js";
import type { LLMUsage } from "./LLMUsage.js";

export interface LLMProvider {
    generate(request: LLMRequest): Promise<LLMResponse>;
    stream(request: LLMRequest,onChunk:(text:string)=>void): Promise<{usage: LLMUsage}>;
}