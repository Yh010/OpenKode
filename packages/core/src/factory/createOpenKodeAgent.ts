import { OpenKodeAgent } from "../agent/OpenKodeAgent.js";
import { OllamaProvider } from "../llm/providers/OllamaProvider.js";
import { TelemetryLLMProvider } from "../llm/providers/TelemetryLLMProvider.js";
import { BatchTelemetryExporter } from "../telemetry/BatchTelemetryExporter.js";
import { ConsoleTelemetry } from "../telemetry/ConsoleTelemetry.js";
import { TelemetryApiClient } from "../telemetry/TelemetryApiClient.js";

export function createOpenKodeAgent() {
    const collectorUrl = process.env.OPENKODE_TELEMETRY_COLLECTOR_URL;
    if (!collectorUrl?.trim()) {
        throw new Error(
            "OPENKODE_TELEMETRY_COLLECTOR_URL must be set to enable telemetry.",
        );
    }
    const telemetryApiClient = new TelemetryApiClient(collectorUrl);
    const batchTelemetryExporter = new BatchTelemetryExporter(telemetryApiClient) ;
    const telemetry = new ConsoleTelemetry(batchTelemetryExporter);
    const llm = new TelemetryLLMProvider(new OllamaProvider(),telemetry);
    return new OpenKodeAgent(llm, telemetry);
}