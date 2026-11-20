import { CloudProvider } from "./providers/CloudProvider.js";
import { OllamaProvider } from "./providers/OllamaProvider.js";

export type ModelProvider = "ollama" | "openai" | "anthropic" | "gemini";
export type ModelConfiguration = { provider: ModelProvider; model: string; apiKey?: string };
export const defaultModels: Record<ModelProvider, string> = { ollama: "qwen2.5-coder:3b", openai: "gpt-5.4-mini", anthropic: "claude-sonnet-4-6", gemini: "gemini-4-hydrogen" };

export function resolveModelConfiguration(environment: NodeJS.ProcessEnv = process.env, saved?: ModelConfiguration): ModelConfiguration {
    const provider = environment.OPENKODE_PROVIDER?.trim() || saved?.provider || "ollama";
    if (!["ollama", "openai", "anthropic", "gemini"].includes(provider)) throw new Error("OPENKODE_PROVIDER must be ollama, openai, anthropic, or gemini.");
    const selected = provider as ModelProvider;
    const model = environment.OPENKODE_MODEL?.trim() || (saved?.provider === selected ? saved.model : undefined) || defaultModels[selected];
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) throw new Error("Enter a valid model ID with openkode configure or OPENKODE_MODEL.");
    if (selected === "ollama") return { provider: selected, model };
    const keyName = selected === "openai" ? "OPENAI_API_KEY" : selected === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
    const apiKey = environment[keyName]?.trim()
        || (saved?.provider === selected ? saved.apiKey : undefined);
    if (!apiKey || /\s/.test(apiKey)) throw new Error(`No valid ${selected} API key is configured. Run openkode configure or set ${keyName}.`);
    return { provider: selected, model, apiKey };
}

export function createModelProvider(configuration: ModelConfiguration) {
    return configuration.provider === "ollama" ? new OllamaProvider(configuration.model)
        : new CloudProvider({ provider: configuration.provider, model: configuration.model, apiKey: configuration.apiKey ?? "" });
}
