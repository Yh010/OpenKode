import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CoderAgent } from "../src/agent/workers/coder/coderAgent.js";
import type { Delegate } from "../src/agent/interface/OrchestratorResponsetypes.js";
import type { LLMProvider } from "../src/llm/interface/LLMProvider.js";
import { detectPackageManager, RunCommandTool } from "../src/tools/command/RunCommandTool.js";

async function withProject(
    manifest: Record<string, unknown>,
    action: (projectRoot: string) => Promise<void>,
    files: string[] = [],
): Promise<void> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "openkode-command-"));
    try {
        await writeFile(path.join(projectRoot, "package.json"), JSON.stringify(manifest));
        await Promise.all(files.map((file) => writeFile(path.join(projectRoot, file), "")));
        await action(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
}

test("detects package managers from declarations and lockfiles", async () => {
    await withProject({ scripts: {} }, async (root) => {
        assert.deepEqual(await detectPackageManager(root, { packageManager: "pnpm@10.0.0" }), { success: true, manager: "pnpm" });
        assert.deepEqual(await detectPackageManager(root, { packageManager: "npm@11.0.0" }), { success: true, manager: "npm" });
        assert.deepEqual(await detectPackageManager(root, { packageManager: "yarn@4.0.0" }), { success: true, manager: "yarn" });
    });
    for (const [lockfile, manager] of [["pnpm-lock.yaml", "pnpm"], ["package-lock.json", "npm"], ["yarn.lock", "yarn"]] as const) {
        await withProject({ scripts: {} }, async (root) => {
            await writeFile(path.join(root, lockfile), "");
            assert.deepEqual(await detectPackageManager(root, {}), { success: true, manager });
        });
    }
});

test("rejects unsupported and ambiguous project configuration", async () => {
    await withProject({ scripts: {} }, async (root) => {
        const unsupported = await detectPackageManager(root, { packageManager: "bun@1.0.0" });
        assert.equal(unsupported.success, false);
        if (!unsupported.success) assert.equal(unsupported.result.code, "UNSUPPORTED_PACKAGE_MANAGER");
    });
    await withProject({ scripts: {} }, async (root) => {
        await writeFile(path.join(root, "pnpm-lock.yaml"), "");
        await writeFile(path.join(root, "yarn.lock"), "");
        const ambiguous = await detectPackageManager(root, {});
        assert.equal(ambiguous.success, false);
        if (!ambiguous.success) assert.equal(ambiguous.result.code, "AMBIGUOUS_PACKAGE_MANAGER");
    });
});

test("runs an approved npm script and reports its structured result", async () => {
    await withProject({ packageManager: "npm@11.0.0", scripts: { test: "node -e \"console.log('verified')\"" } }, async (root) => {
        const result = await new RunCommandTool(root).execute(JSON.stringify({ script: "test" }));
        assert.equal(result.ok, true);
        if (result.ok) {
            const output = JSON.parse(result.output);
            assert.equal(output.manager, "npm");
            assert.equal(output.script, "test");
            assert.equal(output.exitCode, 0);
            assert.equal(output.timedOut, false);
            assert.match(output.output, /verified/);
        }
    });
});

test("reports failed scripts, output caps, and timeouts", async () => {
    await withProject({ packageManager: "npm@11.0.0", scripts: { test: "node -e \"process.exit(3)\"" } }, async (root) => {
        const result = await new RunCommandTool(root).execute(JSON.stringify({ script: "test" }));
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.code, "COMMAND_FAILED");
    });
    await withProject({ packageManager: "npm@11.0.0", scripts: { test: "node -e \"console.log('x'.repeat(1000))\"" } }, async (root) => {
        const result = await new RunCommandTool(root, { maxOutputBytes: 32 }).execute(JSON.stringify({ script: "test" }));
        assert.equal(result.ok, true);
        if (result.ok) assert.ok(JSON.parse(result.output).output.length <= 32);
    });
    await withProject({ packageManager: "npm@11.0.0", scripts: { test: "node -e \"setTimeout(() => {}, 1000)\"" } }, async (root) => {
        const result = await new RunCommandTool(root, { timeoutMs: 25 }).execute(JSON.stringify({ script: "test" }));
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.code, "COMMAND_TIMED_OUT");
    });
});

test("rejects raw commands and non-allowlisted scripts", async () => {
    await withProject({ packageManager: "npm@11.0.0", scripts: { test: "node -e \"process.exit(0)\"", deploy: "echo no" } }, async (root) => {
        const injected = await new RunCommandTool(root).execute(JSON.stringify({ script: "test; echo injected" }));
        assert.equal(injected.ok, false);
        if (!injected.ok) assert.equal(injected.code, "INVALID_COMMAND");
        const unapproved = await new RunCommandTool(root).execute(JSON.stringify({ script: "deploy" }));
        assert.equal(unapproved.ok, false);
        if (!unapproved.ok) assert.equal(unapproved.code, "INVALID_COMMAND");
    });
});

test("rejects missing or invalid manifests and absent scripts", async () => {
    const emptyProject = await mkdtemp(path.join(os.tmpdir(), "openkode-command-"));
    try {
        const missing = await new RunCommandTool(emptyProject).execute(JSON.stringify({ script: "test" }));
        assert.equal(missing.ok, false);
        if (!missing.ok) assert.equal(missing.code, "MANIFEST_NOT_FOUND");
    } finally {
        await rm(emptyProject, { recursive: true, force: true });
    }
    await withProject({ packageManager: "npm@11.0.0", scripts: {} }, async (root) => {
        const missingScript = await new RunCommandTool(root).execute(JSON.stringify({ script: "test" }));
        assert.equal(missingScript.ok, false);
        if (!missingScript.ok) assert.equal(missingScript.code, "SCRIPT_NOT_FOUND");
        await writeFile(path.join(root, "package.json"), "{");
        const invalid = await new RunCommandTool(root).execute(JSON.stringify({ script: "test" }));
        assert.equal(invalid.ok, false);
        if (!invalid.ok) assert.equal(invalid.code, "INVALID_MANIFEST");
    });
});

test("accepts only the exact RunCommandTool response shape", async () => {
    const task: Delegate = { type: "delegate", agent: "coder", task: "verify" };
    const run = async (response: unknown) => new CoderAgent({
        generateForCoder: async () => response,
    } as LLMProvider).run(task);

    assert.deepEqual(await run({ type: "tool_call", toolName: "RunCommandTool", script: "test" }), {
        type: "tool_call",
        toolName: "RunCommandTool",
        script: "test",
    });
    assert.deepEqual(await run({ type: "tool_call", toolName: "RunCommandTool", script: "test; echo injected" }), {
        type: "invalid_response",
        message: "Return exactly one allowed response shape: tool_call, completed, or needs_context.",
    });
});
