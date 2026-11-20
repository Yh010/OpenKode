import { build } from "esbuild";
import { readFile, writeFile, copyFile, mkdir, readdir, access, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(root, "../..");
await mkdir(path.join(root, "dist"), { recursive: true });
const result = await build({
    absWorkingDir: root, entryPoints: ["src/index.ts"], outfile: "dist/index.js",
    bundle: true, platform: "node", target: "node24.14", format: "esm", metafile: true,
    alias: { "@openkode/core": path.join(repository, "packages/core/src/index.ts") },
    banner: { js: "import { createRequire as __openkodeCreateRequire } from 'node:module'; const require = __openkodeCreateRequire(import.meta.url);" },
    legalComments: "eof", sourcemap: false,
});

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes("node_modules")) continue;
    let directory = path.dirname(path.resolve(root, input));
    while (directory !== path.dirname(directory)) {
        const manifest = await readFile(path.join(directory, "package.json"), "utf8").then(JSON.parse).catch(() => undefined);
        if (manifest?.name && manifest?.version) { packages.set(`${manifest.name}@${manifest.version}`, { directory, manifest }); break; }
        directory = path.dirname(directory);
    }
}
const notices = ["Third-party software included in the OpenKode CLI\n"];
for (const [name, { directory, manifest }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const licenses = (await readdir(directory)).filter(file => /^(licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(file));
    if (!licenses.length) throw new Error(`No license text found for bundled dependency ${name}`);
    notices.push(`\n${"=".repeat(72)}\n${name} (${typeof manifest.license === "string" ? manifest.license : "see license"})\n`);
    for (const file of licenses.sort()) notices.push(await readFile(path.join(directory, file), "utf8"));
}
await writeFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), notices.join("\n"));
await copyFile(path.join(repository, "LICENSE"), path.join(root, "LICENSE"));
await chmod(path.join(root, "dist/index.js"), 0o755);
await access(path.join(root, "README.md"));
console.log(`Built self-contained CLI with ${packages.size} bundled dependencies and license notices.`);
