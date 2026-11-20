import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { resolveModelConfiguration, type ModelConfiguration } from "@openkode/core";
import { protectToken } from "../auth/SessionStore.js";

export class ModelConfigurationStore {
    readonly file: string;
    constructor(home = process.env.OPENKODE_HOME ?? path.join(os.homedir(), ".openkode"),
        private readonly protect: typeof protectToken = protectToken) { this.file = path.join(home, "model.json"); }

    async read(): Promise<ModelConfiguration | undefined> {
        let raw: string;
        try { raw = await readFile(this.file, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
        try {
            const saved = JSON.parse(raw);
            if (saved.version !== 1 || !["ollama", "openai", "anthropic", "gemini"].includes(saved.provider) || typeof saved.model !== "string"
                || (saved.provider !== "ollama" && typeof saved.encryptedApiKey !== "string")) throw new Error();
            const apiKey = saved.provider === "ollama" ? undefined : await this.protect(saved.encryptedApiKey, true);
            return resolveModelConfiguration({}, { provider: saved.provider, model: saved.model, ...(apiKey ? { apiKey } : {}) });
        } catch { throw new Error("Could not unlock the saved model settings. Run openkode configure again."); }
    }
    async save(configuration: ModelConfiguration): Promise<void> {
        const selected = resolveModelConfiguration({}, configuration);
        let encryptedApiKey: string | undefined;
        try { if (selected.apiKey) encryptedApiKey = await this.protect(selected.apiKey); }
        catch { throw new Error("Could not encrypt your API key. Model settings were not saved."); }
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        try {
            await writeFile(temporary, JSON.stringify({ version: 1, provider: selected.provider, model: selected.model,
                ...(encryptedApiKey ? { encryptedApiKey } : {}) }), { flag: "wx", mode: 0o600 });
            await rename(temporary, this.file);
        } finally { await rm(temporary, { force: true }); }
    }
}

export async function loadModelConfiguration(): Promise<ModelConfiguration> {
    // Complete environment configuration also works without touching saved keys.
    if (process.env.OPENKODE_PROVIDER) {
        try { return resolveModelConfiguration(process.env); } catch { /* A saved key may complete this choice. */ }
    }
    return resolveModelConfiguration(process.env, await new ModelConfigurationStore().read());
}
