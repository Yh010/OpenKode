import assert from "node:assert/strict";
import test from "node:test";
import { MacKeychainProtection } from "../src/auth/MacKeychainProtection.js";

test("Mac credentials use an authenticated cipher with the master key sent only on stdin", async () => {
    let master = "";
    const calls: { args: string[]; input?: string }[] = [];
    const command = async (args: string[], input?: string) => {
        calls.push({ args, ...(input ? { input } : {}) });
        if (args[0] === "-i") { master = input!.match(/-w (\S+)/)![1]!; return { code: 0, output: "" }; }
        return master ? { code: 0, output: master + "\n" } : { code: 44, output: "" };
    };
    const store = new MacKeychainProtection(command);
    const secret = 'private-key-with-"quotes"\nand newlines';
    const sealed = await store.protect(secret);
    assert.ok(!sealed.includes(secret)); assert.ok(sealed.startsWith("mac-keychain-v1:"));
    assert.equal(await store.protect(sealed, true), secret);
    assert.notEqual(await store.protect(secret), sealed, "Every ciphertext needs a fresh nonce");
    assert.equal(calls.filter(call => call.args[0] === "-i").length, 1);
    assert.ok(calls.every(call => !JSON.stringify(call.args).includes(master)));
    assert.ok(calls.every(call => !JSON.stringify(call).includes(secret)));
    assert.equal(await new MacKeychainProtection(command).protect(sealed, true), secret, "A new process can unlock the same file");
    const bytes = Buffer.from(sealed.slice("mac-keychain-v1:".length), "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await assert.rejects(store.protect("mac-keychain-v1:" + bytes.toString("base64"), true), /Could not access/);
});

test("missing or locked Keychain never replaces an existing master key or leaks helper output", async () => {
    for (const code of [44, 36, null]) {
        let writes = 0;
        const store = new MacKeychainProtection(async args => {
            if (args[0] === "-i") writes++;
            return { code, output: "sensitive-helper-diagnostic" };
        });
        await assert.rejects(store.protect("existing-encrypted-file", true), error => error instanceof Error && !error.message.includes("sensitive-helper-diagnostic"));
        assert.equal(writes, 0);
    }
});

test("native macOS Keychain unlocks encrypted values across instances", { skip: process.platform !== "darwin" }, async () => {
    const first = new MacKeychainProtection();
    const sealed = await first.protect("synthetic-mac-keychain-check");
    assert.equal(await new MacKeychainProtection().protect(sealed, true), "synthetic-mac-keychain-check");
});
