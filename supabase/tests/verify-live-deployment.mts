import assert from "node:assert/strict";
import { AuthenticatedSession, configureAuthNetwork } from "../../packages/cli/src/auth/AuthenticatedSession.ts";

const [runId, count] = process.argv.slice(2);
if (!runId || !/^[0-9a-f-]{36}$/i.test(runId) || !count || !/^[1-9]\d*$/.test(count)) {
    throw new Error("Pass the smoke run UUID and expected event count.");
}
const restore = configureAuthNetwork();
try {
    const session = await AuthenticatedSession.open();
    const headers = { Authorization: `Bearer ${await session.token()}` };
    const api = process.env.COLLECTOR_TEST_URL ?? "https://openkode-collector.onrender.com";
    const pageResponse = await fetch(`${api}/v1/telemetry/traces?runId=${runId}`, { headers, signal: AbortSignal.timeout(90_000) });
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.json() as { items: { spanCount: number }[] };
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]!.spanCount, Number(count));
    const detailResponse = await fetch(`${api}/v1/telemetry/traces/${runId}`, { headers, signal: AbortSignal.timeout(30_000) });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { events: { userId: string }[] };
    assert.equal(detail.events.length, Number(count));
    assert.ok(detail.events.every(event => event.userId === session.user.id));
    console.log(`PASS: the deployed backend retained the owned CLI trace across redeployment and reports all ${count} spans.`);
} finally { restore(); }
