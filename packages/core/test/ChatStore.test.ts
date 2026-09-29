import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatStore } from "../src/chat/ChatStore.js";

async function withTemporaryHome(action: (projectRoot: string, storageHome: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), "openkode-chat-"));
    const projectRoot = path.join(root, "project");
    const storageHome = path.join(root, "home");
    await mkdir(projectRoot);
    try {
        await action(projectRoot, storageHome);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test("persists ordered turns and derives a title from the first prompt", async () => {
    await withTemporaryHome(async (projectRoot, storageHome) => {
        const store = await ChatStore.open(projectRoot, storageHome);
        const chat = await store.create();
        assert.match(chat.id, /^[0-9a-f-]{36}$/);
        await store.append(chat.id, "user", "Explain the authentication flow");
        await store.append(chat.id, "assistant", "The flow starts at login.");

        const reloaded = await ChatStore.open(projectRoot, storageHome);
        const [saved] = await reloaded.list();
        assert.equal(saved?.title, "Explain the authentication flow");
        assert.deepEqual(saved?.turns.map((turn) => [turn.role, turn.content]), [
            ["user", "Explain the authentication flow"],
            ["assistant", "The flow starts at login."],
        ]);
    });
});

test("isolates projects and supports chat renaming", async () => {
    await withTemporaryHome(async (projectRoot, storageHome) => {
        const firstStore = await ChatStore.open(projectRoot, storageHome);
        const chat = await firstStore.create();
        await firstStore.rename(chat.id, "Authentication work");
        const secondProject = path.join(path.dirname(projectRoot), "other-project");
        await mkdir(secondProject);
        const secondStore = await ChatStore.open(secondProject, storageHome);

        assert.equal((await firstStore.list())[0]?.title, "Authentication work");
        assert.deepEqual(await secondStore.list(), []);
    });
});

test("recovers from malformed local chat data", async () => {
    await withTemporaryHome(async (projectRoot, storageHome) => {
        const projectHash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
        const chatDirectory = path.join(storageHome, "chats");
        await mkdir(chatDirectory, { recursive: true });
        await writeFile(path.join(chatDirectory, `${projectHash}.json`), "not-json");

        const store = await ChatStore.open(projectRoot, storageHome);
        assert.deepEqual(await store.list(), []);
        const chat = await store.create("Recovered chat");
        assert.equal((await store.list())[0]?.id, chat.id);
    });
});
