import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { readChatPrompt } from "../src/chatPrompt.js";

test("successive questions stay visible under You instead of reusing the first message as a label", async () => {
    const input = new PassThrough(); const output = new PassThrough();
    let transcript = "";
    output.on("data", chunk => { transcript += chunk; });
    const questions = ["hi", "who are you?", "what tests are written for the CLI?"];
    try {
        for (const question of questions) {
            const pending = readChatPrompt(input, output);
            input.write(`${question}\r`);
            assert.equal(await pending, question);
        }
        const visible = stripVTControlCharacters(transcript).replaceAll("\r", "");
        for (const question of questions) assert.ok(visible.includes(`You › ${question}\n`), visible);
        assert.equal(visible.match(/You › /g)?.length, 3);
        assert.doesNotMatch(visible, /hi ›|who are you\? ›/);
        assert.equal(transcript.includes("\x1b[2m"), false, "Submitted questions must not be dimmed");
        assert.equal(input.listenerCount("keypress"), 0, "The input must be released for chat commands and other prompts");
    } finally { input.destroy(); output.destroy(); }
});

for (const key of ["\x03", "\x04"]) {
    test(`cancel or end-of-input exits cleanly (${key.charCodeAt(0)})`, async () => {
        const input = new PassThrough(); const output = new PassThrough();
        output.resume();
        try {
            const pending = readChatPrompt(input, output);
            input.write(key);
            assert.equal(await pending, undefined);
            assert.equal(input.listenerCount("keypress"), 0);
        } finally { input.destroy(); output.destroy(); }
    });
}
