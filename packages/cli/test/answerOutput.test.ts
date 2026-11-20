import assert from "node:assert/strict";
import test from "node:test";
import { createAnswerOutput } from "../src/answerOutput.js";

test("streamed answers stop progress and print once, while buffered responses still render", () => {
    let output = ""; let stopped = 0; const whole: string[] = [];
    const answer = createAnswerOutput(() => { stopped++; }, text => { whole.push(text); }, text => { output += text; });
    answer.chunk("Hello"); answer.chunk(" world"); answer.finish("Hello world");
    assert.equal(output, "\nOpenKode:\n\nHello world\n"); assert.equal(stopped, 1); assert.deepEqual(whole, []);
    const buffered = createAnswerOutput(() => assert.fail(), text => { whole.push(text); });
    buffered.finish("Completed the approved edit"); assert.deepEqual(whole, ["Completed the approved edit"]);
});

test("interrupted output is marked incomplete and terminal controls cannot execute", () => {
    let output = "";
    const answer = createAnswerOutput(() => {}, () => {}, text => { output += text; });
    answer.chunk("Partial\x1b"); answer.chunk("[2J answer"); answer.interrupt();
    assert.equal(output.includes("\x1b"), false); assert.match(output, /Response incomplete/);
});
