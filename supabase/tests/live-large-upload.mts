import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AuthenticatedSession, configureAuthNetwork } from "../../packages/cli/src/auth/AuthenticatedSession.ts";

// Tests a >1 MB HTTP body using JSON whitespace; stores only a tiny synthetic event.
const restore = configureAuthNetwork();
try {
    const identity = await AuthenticatedSession.open();
    const origin = process.env.COLLECTOR_TEST_URL ?? "https://openkode-collector.onrender.com";
    const now = new Date().toISOString();
    const event = { eventId: randomUUID(), runId: randomUUID(), spanId: randomUUID(), type: "run", name: "openKode-run", status: "ok",
        startedAt: now, endedAt: now, userId: identity.user.id, installationId: identity.installationId, sessionId: identity.sessionId,
        metadata: { synthetic: true, smokeTest: "raised-upload-limit" } };
    const body = JSON.stringify({ events: [event] }) + " ".repeat(2_000_000);
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await identity.token()}` };
    const response = await fetch(`${origin}/v1/telemetry/events`, { method: "POST", headers, body, signal: AbortSignal.timeout(100_000) });
    assert.equal(response.status, 202, `Expected 202 for >1 MB upload, got ${response.status}`);
    const stored = await fetch(`${origin}/v1/telemetry/traces/${event.runId}`, { headers, signal: AbortSignal.timeout(30_000) });
    assert.equal(stored.status, 200);
    const trace = await stored.json() as { events: typeof event[] };
    assert.equal(trace.events.length, 1);
    assert.equal(trace.events[0]!.userId, identity.user.id);
    assert.equal(trace.events[0]!.metadata.smokeTest, "raised-upload-limit");
    console.log(`PASS: hosted collector accepted ${Buffer.byteLength(body)} bytes and stored the synthetic event. Run: ${event.runId}`);
} finally { restore(); }
