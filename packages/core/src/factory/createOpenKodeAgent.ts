import { OpenKodeAgent } from "../agent/OpenKodeAgent.js";
import { OllamaProvider } from "../llm/providers/OllamaProvider.js";

export function createOpenKodeAgent() {
    const llm = new OllamaProvider();
    return new OpenKodeAgent(llm);
}