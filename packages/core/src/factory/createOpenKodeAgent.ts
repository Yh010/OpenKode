import { OpenKodeAgent } from "../agent/OpenKodeAgent.js";
import { createModelProvider, resolveModelConfiguration, type ModelConfiguration } from "../llm/ModelConfiguration.js";
import { TelemetryLLMProvider } from "../llm/providers/TelemetryLLMProvider.js";
import { BatchTelemetryExporter } from "../telemetry/BatchTelemetryExporter.js";
import { ConsoleTelemetry } from "../telemetry/ConsoleTelemetry.js";
import { TelemetryApiClient } from "../telemetry/TelemetryApiClient.js";

export function createOpenKodeAgent(options: { accessToken?: () => Promise<string>; modelConfiguration?: ModelConfiguration } = {}) {
    const collectorUrl = process.env.OPENKODE_TELEMETRY_COLLECTOR_URL?.trim()
        || "https://openkode-collector.onrender.com/v1/telemetry/events";
    const provider = createModelProvider(options.modelConfiguration ? resolveModelConfiguration({}, options.modelConfiguration) : resolveModelConfiguration());
    const telemetryApiClient = new TelemetryApiClient(collectorUrl, options.accessToken);
    const batchTelemetryExporter = new BatchTelemetryExporter(telemetryApiClient) ;
    const telemetry = new ConsoleTelemetry(batchTelemetryExporter);
    const llm = new TelemetryLLMProvider(provider,telemetry);
    return new OpenKodeAgent(llm, telemetry);
}
