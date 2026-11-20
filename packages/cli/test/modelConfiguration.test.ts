import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ModelConfigurationStore, loadModelConfiguration } from "../src/model/ModelConfigurationStore.js";

test("cloud API keys are encrypted on disk, rotate correctly, and disappear when switching to Ollama", { skip: process.platform !== "win32" }, async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "openkode-model-key-"));
    try {
        const store = new ModelConfigurationStore(home);
        assert.equal(await store.read(), undefined);
        const first = { provider: "openai" as const, model: "test-model", apiKey: "sk-test-first-secret" };
        await store.save(first);
        const raw = await readFile(store.file, "utf8");
        assert.equal(raw.includes(first.apiKey), false); assert.equal(JSON.parse(raw).apiKey, undefined);
        assert.deepEqual(await store.read(), first);
        const next = { provider: "anthropic" as const, model: "test-claude", apiKey: "sk-ant-test-second-secret" };
        await store.save(next);
        assert.deepEqual(await store.read(), next);
        assert.equal((await readFile(store.file, "utf8")).includes(next.apiKey), false);
        const gemini = { provider: "gemini" as const, model: "gemini-4-hydrogen", apiKey: "gemini-private-test-key" };
        await store.save(gemini);
        assert.deepEqual(await store.read(), gemini);
        assert.equal((await readFile(store.file, "utf8")).includes(gemini.apiKey), false);
        await store.save({ provider: "ollama", model: "local-model:latest" });
        assert.deepEqual(await store.read(), { provider: "ollama", model: "local-model:latest" });
        assert.equal(JSON.parse(await readFile(store.file, "utf8")).encryptedApiKey, undefined);
    } finally { await rm(home, { recursive: true, force: true }); }
});

test("encryption failure leaves the previous config intact and never includes secret errors", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "openkode-model-failure-"));
    try {
        const store = new ModelConfigurationStore(home, async () => { throw new Error("sk-private-leaked-error"); });
        await store.save({ provider: "ollama", model: "local" });
        const previous = await readFile(store.file, "utf8");
        await assert.rejects(store.save({ provider: "openai", model: "cloud", apiKey: "sk-private" }), error => error instanceof Error && !error.message.includes("sk-private"));
        assert.equal(await readFile(store.file, "utf8"), previous);
        await writeFile(store.file, '{"version":1,"provider":"openai","model":"cloud","encryptedApiKey":"bad"}');
        await assert.rejects(store.read(), error => error instanceof Error && error.message.includes("configure") && !error.message.includes("sk-private"));
    } finally { await rm(home, { recursive: true, force: true }); }
});

test("complete environment settings override even a broken saved config without unlocking it", async () => {
    const keys = ["OPENKODE_HOME", "OPENKODE_PROVIDER", "OPENKODE_MODEL", "OPENAI_API_KEY", "GEMINI_API_KEY"] as const;
    const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const home = await mkdtemp(path.join(os.tmpdir(), "openkode-model-env-"));
    try {
        await writeFile(path.join(home, "model.json"), "broken json");
        Object.assign(process.env, { OPENKODE_HOME: home, OPENKODE_PROVIDER: "openai", OPENKODE_MODEL: "env-model", OPENAI_API_KEY: "env-secret" });
        assert.deepEqual(await loadModelConfiguration(), { provider: "openai", model: "env-model", apiKey: "env-secret" });
        Object.assign(process.env, { OPENKODE_PROVIDER: "gemini", GEMINI_API_KEY: "gemini-env-secret" });
        assert.deepEqual(await loadModelConfiguration(), { provider: "gemini", model: "env-model", apiKey: "gemini-env-secret" });
        assert.equal(await readFile(path.join(home, "model.json"), "utf8"), "broken json");
    } finally {
        for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
        await rm(home, { recursive: true, force: true });
    }
});

test("configure requires a terminal instead of accepting a key through command arguments", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "configure"], {
        cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, OPENAI_API_KEY: "sk-secret-inherited" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(code, 1); assert.match(output, /in a terminal/); assert.equal(output.includes("sk-secret-inherited"), false);
});
