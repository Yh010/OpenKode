import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { resolveModelConfiguration, type ModelConfiguration, type ModelProvider } from "@openkode/core";
import { protectToken } from "../auth/SessionStore.js";
type SavedProvider = { model: string; encryptedApiKey?: string };
type SavedModels = { version: 2; activeProvider: ModelProvider; providers: Partial<Record<ModelProvider, SavedProvider>> };
const providers: ModelProvider[] = ["ollama", "openai", "anthropic", "gemini"];

export class ModelConfigurationStore {
    readonly file: string;
    constructor(home = process.env.OPENKODE_HOME ?? path.join(os.homedir(), ".openkode"),
        private readonly protect: typeof protectToken = protectToken) { this.file = path.join(home, "model.json"); }

    private async record(): Promise<SavedModels | undefined> {
        let raw: string;
        try { raw = await readFile(this.file, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
        try {
            let saved = JSON.parse(raw);
            // Migrate the old single-provider format without unlocking or losing its key.
            if (saved.version === 1) saved = { version: 2, activeProvider: saved.provider, providers: {
                [saved.provider]: { model: saved.model, ...(saved.encryptedApiKey ? { encryptedApiKey: saved.encryptedApiKey } : {}) },
            } };
            if (saved.version !== 2 || !providers.includes(saved.activeProvider) || !saved.providers || typeof saved.providers !== "object"
                || Array.isArray(saved.providers) || !saved.providers[saved.activeProvider]) throw new Error();
            for (const [provider, entry] of Object.entries(saved.providers) as [ModelProvider, SavedProvider][]) {
                if (!providers.includes(provider) || !entry || typeof entry.model !== "string"
                    || (provider !== "ollama" && typeof entry.encryptedApiKey !== "string")) throw new Error();
                resolveModelConfiguration({}, { provider, model: entry.model, ...(provider !== "ollama" ? { apiKey: "validation-only" } : {}) });
            }
            return saved;
        } catch { throw new Error("Could not unlock the saved model settings. Run openkode configure again."); }
    }
    async read(provider?: ModelProvider): Promise<ModelConfiguration | undefined> {
        const saved = await this.record();
        if (!saved) return;
        const selected = provider ?? saved.activeProvider;
        const entry = saved.providers[selected];
        if (!entry) return;
        try {
            const apiKey = selected === "ollama" ? undefined : await this.protect(entry.encryptedApiKey!, true);
            return resolveModelConfiguration({}, { provider: selected, model: entry.model, ...(apiKey ? { apiKey } : {}) });
        } catch { throw new Error("Could not unlock the saved model settings. Run openkode configure again."); }
    }
    async save(configuration: ModelConfiguration): Promise<void> {
        const selected = resolveModelConfiguration({}, configuration);
        let encryptedApiKey: string | undefined;
        try { if (selected.apiKey) encryptedApiKey = await this.protect(selected.apiKey); }
        catch { throw new Error("Could not encrypt your API key. Model settings were not saved."); }
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const lock = `${this.file}.lock`;
        try { await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 }); }
        catch { throw new Error("Another model configuration is being saved. Retry after it finishes."); }
        try {
            const saved = await this.record();
            await writeFile(temporary, JSON.stringify({ version: 2, activeProvider: selected.provider,
                providers: { ...saved?.providers, [selected.provider]: { model: selected.model,
                    ...(encryptedApiKey ? { encryptedApiKey } : {}) } } }), { flag: "wx", mode: 0o600 });
            await rename(temporary, this.file);
        } finally { await rm(temporary, { force: true }); await rm(lock, { force: true }); }
    }
}

export async function loadModelConfiguration(): Promise<ModelConfiguration> {
    // Complete environment configuration also works without touching saved keys.
    if (process.env.OPENKODE_PROVIDER) {
        try { return resolveModelConfiguration(process.env); } catch { /* A saved key may complete this choice. */ }
    }
    const selected = process.env.OPENKODE_PROVIDER?.trim();
    if (selected && !providers.includes(selected as ModelProvider)) return resolveModelConfiguration(process.env);
    return resolveModelConfiguration(process.env, await new ModelConfigurationStore().read(selected as ModelProvider | undefined));
}
