import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import { SpanType, type TelemetryEventInterface } from "../src/telemetry/TelemetryEventInterface.js";
import { ChatStore } from "../src/chat/ChatStore.js";
import { TelemetryApiClient } from "../src/telemetry/TelemetryApiClient.js";
import { createServer } from "node:http";

test("ownership reaches success and failure spans without leaking across concurrent runs", async () => {
    const events: TelemetryEventInterface[] = [];
    const telemetry = new ConsoleTelemetry({ emit: event => { events.push(event); }, async forceFlush() {}, async shutdown() {} });
    const identity = (userId: string) => ({ userId, installationId: `${userId}-install`, sessionId: `${userId}-session`, chatId: `${userId}-chat` });
    await Promise.all(["alice", "bob"].map(user => telemetry.withRun(user, async () => {
        await new Promise(resolve => setTimeout(resolve, user === "alice" ? 5 : 1));
        await assert.rejects(telemetry.withSpan("tool", SpanType.TOOL_EXECUTION, async () => { throw new Error("expected"); }));
    }, undefined, identity(user))));
    assert.equal(events.length, 4);
    for (const event of events) {
        assert.ok(["alice", "bob"].includes(event.userId!));
        assert.equal(event.sessionId, `${event.userId}-session`);
        assert.equal(event.chatId, `${event.userId}-chat`);
        assert.match(event.runId, /^[0-9a-f-]{36}$/);
    }
    assert.notEqual(events.find(e => e.name === "alice")!.runId, events.find(e => e.name === "bob")!.runId);
});

test("account chat stores isolate both other accounts and legacy unowned chats", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "openkode-owners-"));
    try {
        const legacy = await ChatStore.open(home, home);
        await legacy.create("legacy");
        const alice = await ChatStore.open(home, home, "alice");
        const bob = await ChatStore.open(home, home, "bob");
        const chat = await alice.create("alice only");
        assert.equal((await bob.list()).length, 0);
        assert.equal((await alice.list()).length, 1);
        await assert.rejects(bob.append(chat.id, "user", "blocked"), /does not belong/);
    } finally { await rm(home, { recursive: true, force: true }); }
});

test("bearer credentials cannot be sent to insecure remote collectors", () => {
    const token = async () => "private-token";
    assert.throws(() => new TelemetryApiClient("http://example.com/events", token), /HTTPS/);
    assert.throws(() => new TelemetryApiClient("https://user:password@example.com/events", token));
    assert.doesNotThrow(() => new TelemetryApiClient("http://127.0.0.1:3000/v1/telemetry/events", token));
});

test("telemetry obtains a fresh bearer per batch and does not put it in the body", async () => {
    const headers: string[] = [];
    const bodies: string[] = [];
    const server = createServer(async (request, response) => {
        headers.push(request.headers.authorization ?? "");
        let body = "";
        for await (const chunk of request) body += chunk;
        bodies.push(body);
        response.writeHead(202).end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        let count = 0;
        const client = new TelemetryApiClient(`http://127.0.0.1:${address.port}/events`, async () => `token-${++count}`);
        await client.sendBatch([]);
        await client.sendBatch([]);
        assert.deepEqual(headers, ["Bearer token-1", "Bearer token-2"]);
        assert.ok(bodies.every(body => !body.includes("token-")));
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("temporary collector failures retry identical events, while authorization failures do not", async () => {
    const bodies: string[] = [];
    let status = 503;
    const server = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk;
        bodies.push(body);
        response.writeHead(status).end();
        if (status === 503) status = 202;
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const client = new TelemetryApiClient(`http://127.0.0.1:${address.port}/events`);
        await client.sendBatch([]);
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0], bodies[1]);
        status = 403;
        await assert.rejects(client.sendBatch([]), /403/);
        assert.equal(bodies.length, 3);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
