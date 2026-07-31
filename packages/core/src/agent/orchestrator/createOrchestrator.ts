import { OllamaProvider } from "../../llm/providers/OllamaProvider.js";
import { Orchestrator } from "./OrchestratorClass.js";

export function createOrchestrator(){
    const llm = new OllamaProvider() ; //TODO: LLM Should be different
    return new Orchestrator(llm) ;
}