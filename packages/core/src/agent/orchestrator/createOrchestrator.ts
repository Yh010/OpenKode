import type { LLMProvider } from "../../llm/interface/LLMProvider.js";
import { Orchestrator } from "./OrchestratorClass.js";

export function createOrchestrator(llm: LLMProvider){
    return new Orchestrator(llm) ;
}