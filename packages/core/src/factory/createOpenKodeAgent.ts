import { OpenKodeAgent } from "../agent/OpenKodeAgent.js";
import { OllamaProvider } from "../llm/providers/OllamaProvider.js";
import { TelemetryLLMProvider } from "../llm/providers/TelemetryLLMProvider.js";
import { ConsoleTelemetry } from "../telemetry/ConsoleTelemetry.js";

export function createOpenKodeAgent() {
    const telemetry = new ConsoleTelemetry();
    const llm = new TelemetryLLMProvider(new OllamaProvider(),telemetry);
    return new OpenKodeAgent(llm, telemetry);
}