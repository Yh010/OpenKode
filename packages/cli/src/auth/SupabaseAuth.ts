import { createHash, randomBytes } from "node:crypto";

export interface AuthConfig { url: string; key: string }
export interface AuthUser { id: string; email?: string }
export interface AuthTokens { access_token: string; refresh_token: string; expires_at?: number }
const DEFAULT_URL = "https://hzrnpjibpbaxjmlbfkeh.supabase.co";
// Public client key: RLS and verified user tokens provide authorization.
const DEFAULT_KEY = "sb_publishable_Oz_JF1jdKuCkoox5LnffJw_qBTy6NC8";

export function authConfig(env = process.env): AuthConfig {
    const url = new URL(env.OPENKODE_SUPABASE_URL || DEFAULT_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("OPENKODE_SUPABASE_URL must be an HTTPS origin.");
    }
    const key = env.OPENKODE_SUPABASE_PUBLISHABLE_KEY?.trim() || (url.origin === DEFAULT_URL ? DEFAULT_KEY : undefined);
    if (!key) throw new Error("Set OPENKODE_SUPABASE_PUBLISHABLE_KEY to the project's public client key.");
    let publicKey = key.startsWith("sb_publishable_");
    try { publicKey ||= JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role === "anon"; } catch {}
    if (!publicKey) throw new Error("Use a publishable or legacy anon key, never a privileged Supabase key.");
    return { url: url.origin, key };
}

export function pkce() {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export class SupabaseAuth {
    constructor(readonly config: AuthConfig, private readonly request: typeof fetch = fetch) {}

    authorizeUrl(redirect: string, challenge: string): string {
        const url = new URL(`${this.config.url}/auth/v1/authorize`);
        url.search = new URLSearchParams({ provider: "google", redirect_to: redirect,
            code_challenge: challenge, code_challenge_method: "s256", scopes: "email profile" }).toString();
        return url.href;
    }

    async exchange(code: string, verifier: string): Promise<AuthTokens> {
        return this.tokens("pkce", { auth_code: code, code_verifier: verifier });
    }

    async refresh(refreshToken: string): Promise<AuthTokens> {
        return this.tokens("refresh_token", { refresh_token: refreshToken });
    }

    async user(accessToken: string): Promise<AuthUser> {
        const result = await this.call("/user", "GET", undefined, accessToken) as Partial<AuthUser>;
        if (typeof result?.id !== "string") throw new Error("Supabase returned an invalid user response.");
        return { id: result.id, ...(typeof result.email === "string" ? { email: result.email } : {}) };
    }

    async logout(accessToken: string): Promise<void> {
        await this.call("/logout?scope=local", "POST", undefined, accessToken);
    }

    private async tokens(grant: string, body: object): Promise<AuthTokens> {
        const result = await this.call(`/token?grant_type=${grant}`, "POST", body) as Partial<AuthTokens>;
        if (typeof result?.access_token !== "string" || !result.access_token || typeof result.refresh_token !== "string" || !result.refresh_token) {
            throw new Error("Supabase returned an invalid session response.");
        }
        // Provider tokens and response bodies are deliberately not persisted or logged.
        return { access_token: result.access_token, refresh_token: result.refresh_token,
            ...(typeof result.expires_at === "number" ? { expires_at: result.expires_at } : {}) };
    }

    private async call(endpoint: string, method: string, body?: object, token?: string): Promise<unknown> {
        let response: Response;
        try {
            response = await this.request(`${this.config.url}/auth/v1${endpoint}`, {
                method, headers: { apikey: this.config.key, "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000), redirect: "error",
            });
        } catch { throw new Error("Could not reach Supabase. Check your connection and try again."); }
        if (!response.ok) {
            // Never include upstream bodies: they can contain credentials or other private data.
            throw new Error(response.status === 400 || response.status === 401
                ? "Sign-in was rejected or the session expired. Run openkode login again."
                : `Supabase authentication failed (HTTP ${response.status}). Try again later.`);
        }
        if (response.status === 204) return null;
        const text = await response.text();
        if (!text) return null;
        try { return JSON.parse(text); } catch { throw new Error("Supabase returned an invalid response."); }
    }
}
