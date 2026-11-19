import * as p from "@clack/prompts";
import type { Command } from "commander";
import { defaultModels, type ModelProvider } from "@openkode/core";
import { ModelConfigurationStore } from "../model/ModelConfigurationStore.js";

export function loadConfigureCommand(program: Command): void {
    program.command("configure").description("Choose Ollama, OpenAI, or Claude and securely save your API key")
        .action(async () => {
            if (!process.stdin.isTTY || !process.stdout.isTTY) {
                console.error("Run openkode configure in a terminal, or set OPENKODE_PROVIDER, OPENKODE_MODEL and the provider API key in your environment.");
                process.exitCode = 1; return;
            }
            try {
                const store = new ModelConfigurationStore();
                const previous = await store.read().catch(() => undefined);
                p.intro("Set up your model");
                const provider = await p.select<ModelProvider>({ message: "Which provider should OpenKode use?", initialValue: previous?.provider ?? "ollama",
                    options: [{ value: "ollama", label: "Ollama — local model" }, { value: "openai", label: "OpenAI — your API key" }, { value: "anthropic", label: "Claude — your Anthropic API key" }] });
                if (p.isCancel(provider)) { p.cancel("Settings unchanged."); return; }
                const model = await p.text({ message: "Model ID", initialValue: previous?.provider === provider ? previous.model : defaultModels[provider],
                    validate: value => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value ?? "") ? undefined : "Enter the model ID from your provider." });
                if (p.isCancel(model)) { p.cancel("Settings unchanged."); return; }
                let apiKey: string | undefined;
                if (provider !== "ollama") {
                    const savedKey = previous?.provider === provider ? previous.apiKey : undefined;
                    const input = await p.password({ message: savedKey ? "API key (Enter keeps the saved key)" : "API key (saved encrypted on this computer)",
                        validate: value => (value?.trim() || savedKey) && !/\s/.test(value?.trim() ?? "") ? undefined : "Paste a valid API key." });
                    if (p.isCancel(input)) { p.cancel("Settings unchanged."); return; }
                    apiKey = input.trim() || savedKey;
                }
                await store.save({ provider, model: model.trim(), ...(apiKey ? { apiKey } : {}) });
                p.outro(`Saved ${provider} / ${model.trim()}. ${provider === "ollama" ? "Make sure Ollama is running." : "Your key stays encrypted on this computer; model requests go directly to your provider."}`);
                if (process.env.OPENKODE_PROVIDER || process.env.OPENKODE_MODEL) p.log.info("Environment settings take priority over these saved settings.");
            } catch (error) {
                console.error(`[OpenKode] ${error instanceof Error ? error.message : "Could not save model settings."}`);
                process.exitCode = 1;
            }
        });
}
