import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AuthenticatedSession, configureAuthNetwork } from "../../packages/cli/src/auth/AuthenticatedSession.ts";
import { authConfig } from "../../packages/cli/src/auth/SupabaseAuth.ts";
import { Ownership } from "../../../OpenCollector/src/auth/Ownership.ts";
import { SupabaseTelemetryStorage } from "../../../OpenCollector/src/storage/SupabaseTelemetryStorage.ts";

// Writes one labeled, content-free smoke-test event. No prompts or source files.
const restore = configureAuthNetwork();
try {
    const session = await AuthenticatedSession.open();
    const config = authConfig();
    const authorization = `Bearer ${await session.token()}`;
    const headers = { apikey: config.key, Authorization: authorization, "Content-Type": "application/json" };
    const event = { eventId: randomUUID(), runId: randomUUID(), spanId: randomUUID(), type: "run" as const,
        name: "openKode-run", status: "ok" as const, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
        userId: session.user.id, installationId: session.installationId, sessionId: session.sessionId,
        metadata: { smokeTest: "hosted-storage", synthetic: true } };
    const ownership = new Ownership(config.url, config.key);
    const store = new SupabaseTelemetryStorage(config.url, config.key);
    const batch = await ownership.accept({ events: [event] }, authorization);
    await store.append(batch, authorization);
    await store.append(batch, authorization);
    let rows = await store.listEvents({ runId: event.runId }, authorization);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, session.user.id);
    await assert.rejects(store.append({ events: [{ ...event, name: "attempted-overwrite" }] }, authorization));
    await assert.rejects(store.append({ events: [{ ...event, eventId: randomUUID(), llm: { inputTokens: "invalid" } } as any] }, authorization));
    rows = await store.listEvents({ runId: event.runId }, authorization);
    assert.equal(rows[0]!.name, event.name);
    const direct = await fetch(`${config.url}/rest/v1/telemetry_events`, { method: "POST", headers,
        body: JSON.stringify({ user_id: session.user.id, event_id: randomUUID(), run_id: event.runId, started_at: event.startedAt, payload: event }) });
    assert.equal(direct.status, 403);
    const grant = await fetch(`${config.url}/rest/v1/collector_operators`, { method: "POST", headers,
        body: JSON.stringify({ user_id: randomUUID() }) });
    assert.equal(grant.status, 403);
    const anonymous = await fetch(`${config.url}/rest/v1/telemetry_events?select=event_id`, { headers: { apikey: config.key } });
    assert.ok([401, 403].includes(anonymous.status));
    const api = process.env.COLLECTOR_TEST_URL;
    if (api) {
        const result = await fetch(`${api}/v1/telemetry/events`, { method: "POST", headers,
            body: JSON.stringify(batch), signal: AbortSignal.timeout(100_000) });
        assert.equal(result.status, 202);
        const detail = await fetch(`${api}/v1/telemetry/traces/${event.runId}`, { headers });
        assert.equal(detail.status, 200);
        const trace = await detail.json() as { events: unknown[] };
        assert.equal(trace.events.length, 1);
        for (const path of ["/v1/auth/me", "/v1/telemetry/traces", "/v1/telemetry/analytics/overview", "/v1/telemetry/export.xlsx"]) {
            assert.equal((await fetch(`${api}${path}`)).status, 401);
            assert.equal((await fetch(`${api}${path}`, { headers })).status, 200);
        }
        console.log("PASS: hosted HTTP ingestion, trace detail, analytics, Excel export and anonymous access checks.");
    }
    console.log(`PASS: durable commit, duplicate deduplication, immutable payload, verified owner, direct inserts denied, operator self-grants denied, anonymous reads denied. Smoke run: ${event.runId}`);
} finally { restore(); }
