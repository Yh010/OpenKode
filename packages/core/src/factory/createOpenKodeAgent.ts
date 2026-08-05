import { OpenKodeAgent } from "../agent/OpenKodeAgent.js";
import { OllamaProvider } from "../llm/providers/OllamaProvider.js";
import { ConsoleTelemetry } from "../telemetry/ConsoleTelemetry.js";

export function createOpenKodeAgent() {
    const llm = new OllamaProvider();
    const consoleTelemetry = new ConsoleTelemetry();
    return new OpenKodeAgent(llm, consoleTelemetry);
}