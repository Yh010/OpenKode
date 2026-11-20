import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(repository, "packages/cli/package.json"), "utf8"));
const archive = path.resolve(process.argv[2] ?? path.join(repository, `.cache/npm-release/openkode-${manifest.version}.tgz`));
const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/).sort();
assert.deepEqual(files, ["package/LICENSE", "package/README.md", "package/THIRD_PARTY_NOTICES.txt", "package/dist/index.js", "package/package.json"].sort());
let npm;
for (const candidate of [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")]) {
    try { await access(candidate); npm = candidate; break; } catch {}
}
assert.ok(npm, "Cannot locate the Node installation's npm CLI");
const temporary = await mkdtemp(path.join(os.tmpdir(), "openkode-npm-smoke-"));
const install = path.join(temporary, "install");
const project = path.join(temporary, "project");
const home = path.join(temporary, "home");
const log = path.join(temporary, "network.jsonl");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENKODE_|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|GEMINI_API_KEY$|NODE_OPTIONS$)/.test(key)));
env.OPENKODE_HOME = home;
const steps = [];
function run(args, extraEnv = {}, expected = 0) {
    const child = spawn(process.execPath, args, { cwd: project, env: { ...env, ...extraEnv }, windowsHide: true });
    let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error(`Package command timed out: ${args.at(-1)}`)); }, 30_000);
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", code => { clearTimeout(timer); try { assert.equal(code, expected, output); resolve(output); } catch (error) { reject(error); } });
    });
}
try {
    await mkdir(project); await mkdir(home);
    await writeFile(path.join(project, "package.json"), '{"name":"isolated-package-fixture","type":"module"}');
    await writeFile(path.join(project, "entry.ts"), "export const answer = 42;\n");
    // This file must not be loaded by the installed CLI.
    await writeFile(path.join(project, ".env"), "OPENKODE_PROVIDER=invalid\nOPENKODE_SUPABASE_URL=invalid\n");
    await run([npm, "install", "--global", "--prefix", install, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", path.join(temporary, "npm-cache"), archive]);
    const packageRoot = path.join(install, process.platform === "win32" ? "node_modules/openkode" : "lib/node_modules/openkode");
    const bin = path.join(packageRoot, "dist/index.js");
    const installed = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    assert.ok(!Object.keys(installed.dependencies ?? {}).length, "The release must not download core or runtime dependencies");
    assert.match(await run([bin, "--help"]), /configure/);
    assert.equal((await run([bin, "--version"])).trim(), manifest.version);
    assert.match(await run([bin, "whoami"]), /Not signed in/);
    assert.match(await run([bin, "configure"], {}, 1), /terminal/);
    assert.match(await run([bin, "scan"]), /entry\.ts/);
    const shimEnv = { ...env, PATH: `${process.platform === "win32" ? install : path.join(install, "bin")}${path.delimiter}${env.PATH ?? env.Path ?? ""}` };
    if (process.platform === "win32") delete shimEnv.Path;
    const version = execFileSync(process.platform === "win32" ? "cmd.exe" : "/bin/sh", process.platform === "win32" ? ["/d", "/c", "openkode --version"] : ["-c", "openkode --version"], { cwd: project, env: shimEnv, encoding: "utf8", windowsHide: true, timeout: 10_000 });
    assert.equal(version.trim(), manifest.version);
    steps.push("offline global install", "help/version", "npm command shim", "empty-account whoami", "configure TTY guard", "bundled repository scan", "no .env required or auto-loaded");

    const preload = pathToFileURL(path.join(repository, "scripts/fixtures/package-network.mjs")).href;
    const childEnv = { ...env, OPENKODE_PACKAGE_SMOKE_LOG: log };
    const child = spawn(process.execPath, ["--import", preload, bin, "login", "--no-browser"], { cwd: project, env: childEnv, windowsHide: true });
    let login = ""; let completedCallback = false;
    const loginDone = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error("Synthetic login timed out")); }, 20_000);
        child.stdout.on("data", chunk => {
            login += chunk;
            const match = login.match(/https:\/\/hzrnpjibpbaxjmlbfkeh\.supabase\.co\/auth\/v1\/authorize\?[^\s]+/);
            if (!match || completedCallback) return;
            completedCallback = true;
            const callback = new URL(new URL(match[0]).searchParams.get("redirect_to"));
            assert.equal(callback.hostname, "127.0.0.1");
            callback.searchParams.set("code", "synthetic-code");
            void fetch(callback).then(response => assert.equal(response.status, 200)).catch(reject);
        });
        child.stderr.on("data", chunk => { login += chunk; });
        child.on("error", reject);
        child.on("close", code => { clearTimeout(timer); try { assert.equal(code, 0, login); resolve(); } catch (error) { reject(error); } });
    });
    await loginDone;
    assert.match(login, /Signed in as package-test@example.invalid/);
    const result = await run(["--import", preload, bin, "hi"], { ...childEnv, OPENKODE_PROVIDER: "gemini", OPENKODE_MODEL: "synthetic-model", GEMINI_API_KEY: "synthetic-provider-key" });
    assert.match(result, /Hello from the installed package\./);
    assert.match(result, /Input tokens: 10/);
    const requests = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    const batches = requests.filter(item => item.batch);
    assert.ok(batches.length, "Expected default hosted collector uploads");
    const events = batches.flatMap(item => item.batch.events);
    assert.ok(events.some(event => event.type === "run" && event.userId === "00000000-0000-4000-8000-000000000001"));
    assert.ok(events.some(event => event.llm?.provider === "gemini"));
    assert.ok(!JSON.stringify(batches).includes("synthetic-provider-key"));
    steps.push("synthetic PKCE login and encrypted session", "streaming cloud-model request", "owned telemetry to default collector");
    const sha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
    const report = { name: installed.name, version: installed.version, sha256, files, steps, platform: process.platform, checkedAt: new Date().toISOString(), externalModelCalls: 0 };
    await writeFile(path.join(path.dirname(archive), "smoke-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`PASS: ${steps.join(", ")}. No repository node_modules, .env, real account or paid model was used by the installed CLI.`);
} finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("openkode-npm-smoke-"));
    await rm(temporary, { recursive: true, force: true });
}
