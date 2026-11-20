import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenKodeAgent } from "../src/agent/OpenKodeAgent.js";
import { ProgressReporter, toolProgress, type AgentProgress } from "../src/agent/AgentProgress.js";
import { ConsoleTelemetry } from "../src/telemetry/ConsoleTelemetry.js";
import { RuntimeRecorder } from "../src/telemetry/RuntimeRecorder.js";
import type { TelemetryEventInterface } from "../src/telemetry/TelemetryEventInterface.js";
import type { LLMProvider } from "../src/llm/interface/LLMProvider.js";

test("file explanations show ordered live progress and still export traces without console dumps", async context => {
    const log = context.mock.method(console, "log", () => {});
    const dir = context.mock.method(console, "dir", () => {});
    const home = await mkdtemp(path.join(os.tmpdir(), "openkode-progress-"));
    const previous = process.cwd();
    const file = path.join(home, "example.ts");
    const events: TelemetryEventInterface[] = [];
    const updates: AgentProgress[] = [];
    try {
        await writeFile(file, "export const answer = 42;");
        process.chdir(home);
        const telemetry = new ConsoleTelemetry({ emit: event => { events.push(event); }, async forceFlush() {}, async shutdown() {} });
        const llm = { generateForOrchestrator: async () => {
            assert.equal(updates.at(-1)?.message, "Explaining the files that were read");
            return { type: "final", answer: "It exports the answer." };
        } } as unknown as LLMProvider;
        const result = await new OpenKodeAgent(llm, telemetry).run({ prompt: "Explain example.ts" }, () => {}, event => { updates.push(event); });
        assert.equal(result.response, "It exports the answer.");
        assert.match(updates[0]!.message, /Reading.*example.ts/);
        assert.match(updates[1]!.message, /Read.*example.ts.*1 line/);
        assert.equal(updates[1]!.detail, "export const answer = 42;");
        assert.ok(events.some(event => event.type === "tool"));
        assert.ok(events.some(event => event.type === "run"));
        assert.equal(log.mock.callCount(), 0); assert.equal(dir.mock.callCount(), 0);
        assert.equal(JSON.stringify(updates).includes("spanId"), false);
    } finally { process.chdir(previous); await rm(home, { recursive: true, force: true }); }
});

test("tool updates show bounded results, strip terminal controls, and redact credentials", () => {
    const reporter = new ProgressReporter();
    const updates: AgentProgress[] = [];
    return reporter.run(event => { updates.push(event); }, async () => {
        reporter.emit(toolProgress("ReadFileTool", { fileToRead: "config.ts" }, { ok: true, output: '\x1b[2Jpassword="private-password"\nGEMINI_API_KEY="AIza123456789012345678901234567890123"\n' + "line\n".repeat(50) }));
        reporter.emit(toolProgress("GlobTool", { pattern: "**/*.ts" }, { ok: true, output: JSON.stringify({ matches: Array.from({ length: 20 }, (_, i) => `src/${i}.ts`) }) }));
        reporter.emit(toolProgress("GrepTool", { pattern: "answer" }, { ok: true, output: JSON.stringify({ matches: [{ path: "example.ts", line: 3, text: "answer = 42" }], errors: [{ path: "missing.ts" }] }) }));
        reporter.emit(toolProgress("RunCommandTool", { script: "test" }, { ok: true, output: JSON.stringify({ exitCode: 0, output: "3 tests passed" }) }));
        assert.doesNotMatch(JSON.stringify(updates), /private-password|AIza123|\\u001b/);
        assert.match(updates[0]!.detail!, /REDACTED/); assert.ok(updates[0]!.detail!.split("\n").length <= 6);
        assert.match(updates[1]!.detail!, /15 more/); assert.match(updates[2]!.detail!, /example.ts:3: answer = 42/);
        assert.match(updates[2]!.message, /1 files could not be searched/);
        assert.equal(updates[3]!.detail, "Exit code: 0\n3 tests passed");
        assert.doesNotMatch(JSON.stringify(updates), /"exitCode"/);
    });
});

test("blocked, failed and throwing tools report outcomes without claiming success", async () => {
    const telemetry = new ConsoleTelemetry();
    const runtime = new RuntimeRecorder(telemetry);
    const step = runtime.step("coder", 1, undefined);
    const updates: AgentProgress[] = [];
    await runtime.progress.run(event => { updates.push(event); }, () => telemetry.withRun("test", async () => {
        const result = await runtime.tool(step, "EditFileTool", { path: "outside.ts" }, false, async () => ({ ok: false, code: "UNAPPROVED_FILE", message: "Not approved." }));
        assert.equal(result.ok, false);
        assert.match(updates.at(-1)!.message, /Blocked/);
        const error = new Error("Tool failed");
        await assert.rejects(runtime.tool(step, "ReadFileTool", { fileToRead: "missing.ts" }, true, async () => { throw error; }), error);
        assert.equal(updates.at(-1)!.message, "ReadFileTool failed");
        assert.doesNotMatch(JSON.stringify(updates), /Edited|Wrote/);
    }));
});

test("progress callbacks are isolated across concurrent runs and cannot break execution", async () => {
    const reporter = new ProgressReporter();
    const left: string[] = []; const right: string[] = [];
    await Promise.all([reporter.run(event => { left.push(event.message); }, async () => {
        await new Promise(resolve => setTimeout(resolve, 5)); reporter.emit({ kind: "status", message: "left" });
    }), reporter.run(event => { right.push(event.message); }, async () => {
        reporter.emit({ kind: "status", message: "right" });
    })]);
    assert.deepEqual(left, ["left"]); assert.deepEqual(right, ["right"]);
    await reporter.run(() => { throw new Error("Broken renderer"); }, async () => reporter.emit({ kind: "result", message: "still finished" }));
});
