import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { AuthenticatedSession, configureAuthNetwork } from "../../packages/cli/src/auth/AuthenticatedSession.ts";
import { authConfig, SupabaseAuth } from "../../packages/cli/src/auth/SupabaseAuth.ts";
import { SessionStore } from "../../packages/cli/src/auth/SessionStore.ts";

// Sign into a normal Google account using an isolated OPENKODE_HOME first.
// The operator's existing sign-in is used only to verify the accepted trace.
const testHome = process.env.OPENKODE_HOME;
const operatorHome = process.env.OPENKODE_OPERATOR_HOME ?? path.join(os.homedir(), ".openkode");
const expectedEmail = process.env.EXPECTED_SIGNUP_TEST_EMAIL;
if (!testHome || !expectedEmail || path.resolve(testHome) === path.resolve(operatorHome)) throw new Error("Use an isolated OPENKODE_HOME and set EXPECTED_SIGNUP_TEST_EMAIL.");
const restore = configureAuthNetwork();
const config = authConfig();
const api = process.env.COLLECTOR_TEST_URL ?? "https://openkode-collector.onrender.com";
let user: AuthenticatedSession | undefined;
try {
    user = await AuthenticatedSession.open();
    assert.equal(user.user.email, expectedEmail);
    const chatId = randomUUID(); await user.chat(chatId);
    const event = { eventId: randomUUID(), runId: randomUUID(), spanId: randomUUID(), type: "run", name: "openKode-run", status: "ok",
        startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), userId: user.user.id,
        installationId: user.installationId, sessionId: user.sessionId, chatId, metadata: { synthetic: true, smokeTest: "public-signup" } };
    const headers = { Authorization: `Bearer ${await user.token()}`, "Content-Type": "application/json" };
    const post = (payload: unknown) => fetch(`${api}/v1/telemetry/events`, { method: "POST", headers, body: JSON.stringify({ events: [payload] }), signal: AbortSignal.timeout(100_000) });
    assert.equal((await post(event)).status, 202);
    assert.equal((await post({ ...event, eventId: randomUUID(), userId: randomUUID() })).status, 403);
    for (const route of ["/v1/auth/me", "/v1/telemetry/traces", `/v1/telemetry/traces/${event.runId}`, "/v1/telemetry/export.xlsx"]) {
        assert.equal((await fetch(`${api}${route}`, { headers, signal: AbortSignal.timeout(30_000) })).status, 403);
    }
    const stored = await fetch(`${config.url}/rest/v1/runs?id=eq.${event.runId}&select=user_id,session_id,chat_id`, { headers: { ...headers, apikey: config.key }, signal: AbortSignal.timeout(30_000) });
    assert.equal(stored.status, 200);
    assert.deepEqual(await stored.json(), [{ user_id: user.user.id, session_id: user.sessionId, chat_id: chatId }]);
    const hidden = await fetch(`${config.url}/rest/v1/telemetry_events?run_id=eq.${event.runId}&select=event_id`, { headers: { ...headers, apikey: config.key }, signal: AbortSignal.timeout(30_000) });
    assert.equal(hidden.status, 200); assert.deepEqual(await hidden.json(), []);

    process.env.OPENKODE_HOME = operatorHome;
    const operator = await AuthenticatedSession.open();
    assert.notEqual(operator.user.id, user.user.id);
    const detail = await fetch(`${api}/v1/telemetry/traces/${event.runId}`, { headers: { Authorization: `Bearer ${await operator.token()}` }, signal: AbortSignal.timeout(30_000) });
    assert.equal(detail.status, 200);
    const trace = await detail.json() as { events: { userId: string; sessionId: string; chatId: string }[] };
    assert.equal(trace.events.length, 1);
    assert.equal(trace.events[0]!.userId, user.user.id); assert.equal(trace.events[0]!.sessionId, user.sessionId); assert.equal(trace.events[0]!.chatId, chatId);
    console.log(`PASS: new Google account registered installation/session/chat, uploaded its own trace, could not impersonate another user, could not read dashboard APIs or event rows, and its trace is visible to the operator. Run: ${event.runId}`);
} finally {
    process.env.OPENKODE_HOME = testHome;
    if (user) {
        await new SupabaseAuth(config).logout(await user.token()).catch(() => console.error("Could not revoke the isolated test session; local credentials will be removed."));
        await new SessionStore(config.url, testHome).clear();
    }
    restore();
}
