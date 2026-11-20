import assert from "node:assert/strict";
import test from "node:test";
import { createProgressDisplay } from "../src/progress.js";

test("progress preserves completed tool results and stops the active spinner on success or failure", () => {
    const calls: string[] = [];
    const display = createProgressDisplay({ start: text => { calls.push(`start: ${text}`); }, stop: text => { calls.push(`stop: ${text}`); }, log: text => { calls.push(`log: ${text}`); } });
    display.update({ kind: "status", message: "Reading example.ts" });
    display.update({ kind: "result", message: "Read example.ts", detail: "export const answer = 42;" });
    display.update({ kind: "status", message: "Planning" });
    display.update({ kind: "status", message: "Preparing changes" });
    display.finish("Could not complete the request");
    display.finish("Duplicate finish");
    assert.deepEqual(calls, ["start: Reading example.ts", "stop: Read example.ts", "log: export const answer = 42;", "start: Planning", "stop: Planning", "start: Preparing changes", "stop: Could not complete the request"]);
});

test("results can arrive without a spinner and do not leave one running", () => {
    const calls: string[] = [];
    const display = createProgressDisplay({ start: () => assert.fail(), stop: () => assert.fail(), log: text => { calls.push(text); } });
    display.update({ kind: "result", message: "Found 2 files", detail: "a.ts\nb.ts" });
    display.finish("Done");
    assert.deepEqual(calls, ["Found 2 files", "a.ts\nb.ts"]);
});
