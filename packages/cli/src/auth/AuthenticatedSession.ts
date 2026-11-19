import { authConfig, SupabaseAuth, type AuthUser } from "./SupabaseAuth.js";
import { SessionStore } from "./SessionStore.js";
import { setGlobalProxyFromEnv } from "node:http";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function configureAuthNetwork(): () => void {
    if (!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy)) return () => {};
    const original = getCACertificates("default");
    setDefaultCACertificates([...original, ...getCACertificates("system")]);
    const restore = setGlobalProxyFromEnv();
    return () => { restore(); setDefaultCACertificates(original); };
}

export class AuthenticatedSession {
    private accessToken = "";
    private expiresAt = 0;
    private refreshing: Promise<string> | undefined;
    user!: AuthUser;
    readonly sessionId = randomUUID();
    installationId = "";
    private readonly chats = new Set<string>();
    private constructor(private readonly api: SupabaseAuth, private readonly store: SessionStore) {}
    get accountScope(): string { return `${this.api.config.url}:${this.user.id}`; }

    static async open(): Promise<AuthenticatedSession> {
        const api = new SupabaseAuth(authConfig());
        const session = new AuthenticatedSession(api, new SessionStore(api.config.url));
        await session.token();
        session.user = await api.user(session.accessToken);
        const home = process.env.OPENKODE_HOME ?? path.join(os.homedir(), ".openkode");
        const directory = path.join(home, "identity");
        await mkdir(directory, { recursive: true });
        const key = createHash("sha256").update(`${api.config.url}:${session.user.id}`).digest("hex");
        const file = path.join(directory, `${key}.json`);
        try { await writeFile(file, JSON.stringify({ installationId: randomUUID() }), { flag: "wx" }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        const record = JSON.parse(await readFile(file, "utf8"));
        if (typeof record.installationId !== "string" || !/^[0-9a-f-]{36}$/i.test(record.installationId)) throw new Error("Invalid local installation registration.");
        session.installationId = record.installationId;
        await session.register("installations", { id: session.installationId, user_id: session.user.id });
        await session.register("cli_sessions", { id: session.sessionId, installation_id: session.installationId, user_id: session.user.id });
        return session;
    }

    async token(): Promise<string> {
        if (Date.now() < this.expiresAt) return this.accessToken;
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.store.exclusive(async () => {
            const refresh = await this.store.read();
            if (!refresh) throw new Error("Sign in first with openkode login.");
            const tokens = await this.api.refresh(refresh);
            await this.store.save(tokens.refresh_token);
            const identity = await this.api.user(tokens.access_token);
            if (this.user && identity.id !== this.user.id) throw new Error("The signed-in account changed. Restart OpenKode.");
            this.accessToken = tokens.access_token;
            // Refresh conservatively; never use a locally decoded JWT as proof of identity.
            this.expiresAt = Math.min(Date.now() + 60_000, (tokens.expires_at ?? 0) * 1000 - 30_000);
            return this.accessToken;
        }).finally(() => { this.refreshing = undefined; });
        return this.refreshing;
    }

    async chat(id: string): Promise<void> {
        if (this.chats.has(id)) return;
        await this.register("chats", { id, user_id: this.user.id });
        this.chats.add(id);
    }

    private async register(table: string, row: object): Promise<void> {
        const response = await fetch(`${this.api.config.url}/rest/v1/${table}`, {
            method: "POST", headers: { apikey: this.api.config.key, Authorization: `Bearer ${await this.token()}`,
                "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
            body: JSON.stringify(row), signal: AbortSignal.timeout(15_000), redirect: "error",
        });
        if (!response.ok) throw new Error(`Could not register ${table} (HTTP ${response.status}).`);
    }
}
