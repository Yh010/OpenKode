import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authConfig, pkce, SupabaseAuth } from "../src/auth/SupabaseAuth.js";
import { loginCallback } from "../src/auth/callback.js";
import { SessionStore } from "../src/auth/SessionStore.js";

test("public config rejects privileged keys and non-HTTPS origins", () => {
    assert.ok(authConfig({}).key.startsWith("sb_publishable_"));
    for (const url of ["http://example.com", "https://user:secret@example.com", "https://example.com/path"]) {
        assert.throws(() => authConfig({ OPENKODE_SUPABASE_URL: url }));
    }
    assert.throws(() => authConfig({ OPENKODE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_dont-use" }));
    assert.throws(() => authConfig({ OPENKODE_SUPABASE_URL: "https://example.com" }));
});

test("PKCE challenge matches verifier and is unique per login", () => {
    const first = pkce();
    assert.equal(first.challenge, createHash("sha256").update(first.verifier).digest("base64url"));
    assert.notEqual(first.verifier, pkce().verifier);
    const url = new URL(new SupabaseAuth(authConfig({})).authorizeUrl("http://127.0.0.1:43821/auth/callback/test", first.challenge));
    assert.equal(url.searchParams.get("provider"), "google");
    assert.equal(url.searchParams.get("code_challenge_method"), "s256");
    assert.ok(!url.href.includes(first.verifier));
});

test("exchange, refresh, user verification, and scoped logout use correct requests", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const api = new SupabaseAuth(authConfig({}), async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("/logout")) return new Response(null, { status: 204 });
        if (String(url).endsWith("/user")) return Response.json({ id: "user-1", email: "user@example.com" });
        return Response.json({ access_token: "access", refresh_token: "rotated", provider_token: "never-persist" });
    });
    assert.deepEqual(await api.exchange("code", "verifier"), { access_token: "access", refresh_token: "rotated" });
    assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { auth_code: "code", code_verifier: "verifier" });
    await api.refresh("old-token");
    assert.deepEqual(JSON.parse(calls[1]!.init!.body as string), { refresh_token: "old-token" });
    assert.equal((await api.user("access")).id, "user-1");
    await api.logout("access");
    assert.ok(calls[3]!.url.endsWith("/logout?scope=local"));
    assert.equal((calls[2]!.init!.headers as Record<string, string>).Authorization, "Bearer access");
});

test("upstream private error bodies are never included in CLI errors", async () => {
    const api = new SupabaseAuth(authConfig({}), async () => new Response("secret-token-and-email", { status: 401 }));
    await assert.rejects(api.refresh("refresh"), error => error instanceof Error && !error.message.includes("secret-token") && error.message.includes("login"));
});

test("callback ignores wrong paths and methods, then completes one valid login", async () => {
    let received = "";
    const callback = await loginCallback(async code => { received = code; return "signed-in"; }, { port: 0 });
    try {
        assert.equal((await fetch(new URL("/wrong", callback.redirect))).status, 404);
        assert.equal((await fetch(`${callback.redirect}?code=test`, { method: "POST" })).status, 405);
        assert.equal(received, "");
        const response = await fetch(`${callback.redirect}?code=expected`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Signed in/);
        assert.equal(await callback.result, "signed-in");
        assert.equal(received, "expected");
        assert.equal((await fetch(`${callback.redirect}?code=again`)).status, 409);
    } finally { await callback.close(); }
});

test("callback rejects duplicate codes, provider denial, timeout, cancellation, and exchange failure", async () => {
    for (const query of ["code=a&code=b", "error=access_denied", "code="]) {
        const callback = await loginCallback(async () => assert.fail("must not exchange"), { port: 0 });
        try {
            assert.equal((await fetch(`${callback.redirect}?${query}`)).status, 400);
            await assert.rejects(callback.result, /cancelled|invalid/);
        } finally { await callback.close(); }
    }
    const timeout = await loginCallback(async () => {}, { port: 0, timeoutMs: 10 });
    try { await assert.rejects(timeout.result, /timed out/); } finally { await timeout.close(); }
    const abort = new AbortController();
    const cancelled = await loginCallback(async () => {}, { port: 0, signal: abort.signal });
    abort.abort();
    try { await assert.rejects(cancelled.result, /cancelled/); } finally { await cancelled.close(); }
    const failure = await loginCallback(async () => { throw new Error("exchange failed"); }, { port: 0 });
    try {
        assert.equal((await fetch(`${failure.redirect}?code=valid`)).status, 400);
        await assert.rejects(failure.result, /exchange failed/);
    } finally { await failure.close(); }
});

test("auth commands are mutually exclusive and failed operations release the lock", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "openkode-lock-"));
    const store = new SessionStore("https://example.com", home);
    try {
        await store.exclusive(async () => { await assert.rejects(store.exclusive(async () => {}), /Another authentication/); });
        await assert.rejects(store.exclusive(async () => { throw new Error("failure"); }), /failure/);
        assert.equal(await store.exclusive(async () => "released"), "released");
    } finally { await rm(home, { recursive: true, force: true }); }
});

test("session persistence encrypts, rotates, and clears refresh tokens", { skip: !["win32", "darwin"].includes(process.platform) }, async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "openkode-session-"));
    const store = new SessionStore("https://example.com", home);
    try {
        assert.equal(await store.read(), undefined);
        await store.save("temporary-test-refresh-token");
        assert.ok(!(await readFile(store.file, "utf8")).includes("temporary-test-refresh-token"));
        assert.equal(await store.read(), "temporary-test-refresh-token");
        await store.save("rotated-test-refresh-token");
        assert.equal(await store.read(), "rotated-test-refresh-token");
        await store.clear();
        assert.equal(await store.read(), undefined);
    } finally { await rm(home, { recursive: true, force: true }); }
});
