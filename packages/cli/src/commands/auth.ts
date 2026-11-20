import { spawn } from "node:child_process";
import { setGlobalProxyFromEnv } from "node:http";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { Command } from "commander";
import { authConfig, pkce, SupabaseAuth } from "../auth/SupabaseAuth.js";
import { SessionStore } from "../auth/SessionStore.js";
import { loginCallback } from "../auth/callback.js";

async function openBrowser(url: string): Promise<void> {
    // PowerShell receives only the public authorization URL on stdin, not a token.
    await new Promise<void>((resolve, reject) => {
        const child = process.platform === "darwin"
            ? spawn("/usr/bin/open", [url], { stdio: ["pipe", "ignore", "ignore"] })
            : spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                "Start-Process -FilePath ([Console]::In.ReadToEnd())"], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
        const timeout = setTimeout(() => { child.kill(); reject(new Error("Could not open your browser.")); }, 5_000);
        child.once("error", () => { clearTimeout(timeout); reject(new Error("Could not open your browser.")); });
        child.once("close", code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error("Could not open your browser.")); });
        child.stdin.on("error", () => {});
        child.stdin.end(url);
    });
}

function authAction(action: (api: SupabaseAuth, store: SessionStore) => Promise<void>) {
    return async () => {
        let restoreNetwork: (() => void) | undefined;
        const originalCAs = getCACertificates("default");
        try {
            if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
                setDefaultCACertificates([...originalCAs, ...getCACertificates("system")]);
                restoreNetwork = setGlobalProxyFromEnv();
            }
            const api = new SupabaseAuth(authConfig());
            const store = new SessionStore(api.config.url);
            await store.exclusive(() => action(api, store));
        } catch (error) {
            console.error(`[OpenKode] ${error instanceof Error ? error.message : "Authentication failed."}`);
            process.exitCode = 1;
        } finally {
            restoreNetwork?.();
            setDefaultCACertificates(originalCAs);
        }
    };
}

export function loadAuthCommands(program: Command): void {
    const login = program.command("login").description("Sign in to OpenKode with Google (Windows or macOS)")
        .option("--no-browser", "Print the sign-in URL without opening a browser");
    login.action(authAction(async (api, store) => {
            if (!["win32", "darwin"].includes(process.platform)) throw new Error("Secure login supports Windows and macOS.");
            const { verifier, challenge } = pkce();
            const abort = new AbortController();
            const cancel = () => abort.abort();
            process.once("SIGINT", cancel);
            let callback: Awaited<ReturnType<typeof loginCallback>> | undefined;
            try {
                callback = await loginCallback(async code => {
                    const tokens = await api.exchange(code, verifier);
                    const user = await api.user(tokens.access_token);
                    await store.save(tokens.refresh_token);
                    return user;
                }, { signal: abort.signal });
                // Cancellation can happen while the OS is opening a browser.
                void callback.result.catch(() => {});
                const url = api.authorizeUrl(callback.redirect, challenge);
                console.log(`Finish Google sign-in in your browser (3-minute timeout).\n${url}`);
                if (login.opts().browser !== false) {
                    await openBrowser(url).catch(() => console.log("Could not open your browser. Open the sign-in link above on this computer."));
                }
                const user = await callback.result as { id: string; email?: string };
                console.log(`Signed in as ${user.email ?? user.id}.`);
            } finally {
                process.off("SIGINT", cancel);
                await callback?.close();
            }
        }));

    program.command("whoami").description("Show the signed-in OpenKode account")
        .action(authAction(async (api, store) => {
            const token = await store.read();
            if (!token) { console.log("Not signed in. Run openkode login."); return; }
            const tokens = await api.refresh(token);
            await store.save(tokens.refresh_token);
            const user = await api.user(tokens.access_token);
            console.log(`Signed in as ${user.email ?? user.id}.\nUser ID: ${user.id}`);
        }));

    program.command("logout").description("Sign out of this OpenKode installation")
        .option("--local", "Forget local credentials without contacting Supabase")
        .action(options => authAction(async (api, store) => {
            if (!options.local) {
                const token = await store.read();
                if (token) {
                    const tokens = await api.refresh(token);
                    await store.save(tokens.refresh_token);
                    await api.logout(tokens.access_token);
                }
            }
            await store.clear();
            console.log(options.local ? "Local session removed. Server-side revocation was not requested." : "Signed out of this installation.");
        })());
}
