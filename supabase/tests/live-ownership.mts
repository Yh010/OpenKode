import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuthenticatedSession, configureAuthNetwork } from "../../packages/cli/src/auth/AuthenticatedSession.ts";
import { authConfig } from "../../packages/cli/src/auth/SupabaseAuth.ts";
import { Ownership, OwnershipError } from "../../../OpenCollector/src/auth/Ownership.ts";
import { RawEventSegmentWriter } from "../../../OpenCollector/src/raw-events/RawEventSegmentWriter.ts";
import { normalizeRawTelemetryBatch } from "../../../OpenCollector/src/processed-events/normalizeRawTelemetryBatch.ts";
const restore = configureAuthNetwork();
const temp = await mkdtemp(path.join(os.tmpdir(), "openkode-owned-ingestion-"));
try {
    const first = await AuthenticatedSession.open();
    const second = await AuthenticatedSession.open();
    assert.equal(first.installationId, second.installationId);
    assert.notEqual(first.sessionId, second.sessionId);
    const chatId = randomUUID();
    await second.chat(chatId);
    const config = authConfig();
    const guard = new Ownership(config.url, config.key);
    const event = { eventId: randomUUID(), runId: randomUUID(), spanId: randomUUID(), type: "run" as const,
        name: "ownership-smoke-test", status: "ok" as const, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
        userId: second.user.id, installationId: second.installationId, sessionId: second.sessionId, chatId };
    const authorization = `Bearer ${await second.token()}`;
    const batch = await guard.accept({ events: [event] }, authorization);
    await guard.accept({ events: [event] }, authorization); // Idempotent run registration.
    await assert.rejects(guard.accept({ events: [{ ...event, userId: randomUUID() }] }, authorization), e => e instanceof OwnershipError && e.status === 403);
    await assert.rejects(guard.accept({ events: [{ ...event, runId: randomUUID(), installationId: randomUUID() }] }, authorization), e => e instanceof OwnershipError && e.status === 403);
    await assert.rejects(guard.accept({ events: [event] }, undefined), e => e instanceof OwnershipError && e.status === 401);
    const writer = new RawEventSegmentWriter({ rootDirectory: temp, maxSegmentBytes: 1000000, segmentIntervalMs: 60000 });
    const stored = await writer.write(batch.events);
    const raw = JSON.parse((await readFile(stored.filePath, "utf8")).trim());
    const normalized = normalizeRawTelemetryBatch(raw);
    assert.equal(normalized[0]!.userId, second.user.id);
    assert.equal(normalized[0]!.chatId, chatId);
    const response = await fetch(`${config.url}/rest/v1/runs?id=eq.${event.runId}&select=id,user_id,session_id,chat_id`, {
        headers: { apikey: config.key, Authorization: authorization }, signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    const rows = await response.json() as any[];
    assert.equal(rows[0].user_id, second.user.id);
    assert.equal(rows[0].chat_id, chatId);
    console.log("PASS: stable installation, distinct launches, chat registration, verified run ownership, idempotency, forged IDs rejected, raw and normalized ownership preserved, Supabase ownership row verified.");
} finally { restore(); await rm(temp, { recursive: true, force: true }); }
