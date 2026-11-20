import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function parseVersion(version) {
    if (typeof version !== "string" || !stable.test(version)) throw new Error(`Expected a stable release version: ${version}`);
    const parts = version.split(".").map(Number);
    if (parts.some(part => !Number.isSafeInteger(part))) throw new Error("Release version is too large");
    return parts;
}
function compare(a, b) {
    const aa = parseVersion(a), bb = parseVersion(b);
    return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
}
export function releasePlan(packument, baseVersion, sourceSha) {
    parseVersion(baseVersion);
    if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Expected the full source commit SHA");
    if (packument.name !== "openkode" || !packument.versions || typeof packument.versions !== "object" || Array.isArray(packument.versions)) {
        throw new Error("Invalid npm registry package metadata");
    }
    const versions = Object.keys(packument.versions).filter(version => stable.test(version)).sort(compare);
    const existing = versions.findLast(version => packument.versions[version]?.gitHead === sourceSha);
    if (existing) return { version: existing, publish: false };
    const highest = versions.at(-1);
    if (!highest || compare(baseVersion, highest) > 0) return { version: baseVersion, publish: true };
    const parts = parseVersion(highest);
    parts[2] += 1;
    const version = parts.join(".");
    parseVersion(version);
    return { version, publish: true };
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repository, "packages/cli/package.json");
async function registryPackage() {
    const response = await fetch("https://registry.npmjs.org/openkode", { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Could not read npm release metadata (HTTP ${response.status})`);
    return response.json();
}
async function main(command) {
    const sourceSha = process.env.GITHUB_SHA;
    if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) throw new Error("Expected GITHUB_SHA");
    if (command === "prepare") {
        const version = process.env.RELEASE_VERSION;
        parseVersion(version);
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.version = version;
        manifest.gitHead = sourceSha;
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        console.log(`Prepared openkode@${version} from ${sourceSha}`);
    } else if (command === "plan") {
        const action = process.env.RELEASE_ACTION;
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        let plan;
        if (action === "validate") plan = { version: manifest.version, publish: false };
        else if (action === "publish") plan = releasePlan(await registryPackage(), manifest.version, sourceSha);
        else if (action === "verify-public") {
            const metadata = await registryPackage();
            const version = metadata["dist-tags"]?.latest;
            parseVersion(version);
            if (!metadata.versions?.[version]) throw new Error("npm latest version is missing");
            plan = { version, publish: false };
        } else throw new Error("Unknown release action");
        parseVersion(plan.version);
        const output = `version=${plan.version}\npublish=${plan.publish}\naction=${action}\n`;
        if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
        console.log(output.trim());
    } else if (command === "tag") {
        const version = process.env.RELEASE_VERSION;
        parseVersion(version);
        const repo = process.env.GITHUB_REPOSITORY;
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw new Error("Expected GITHUB_REPOSITORY");
        if (!process.env.GH_TOKEN) throw new Error("Expected GH_TOKEN for release tagging");
        const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" };
        const endpoint = `https://api.github.com/repos/${repo}/git`;
        const existing = await fetch(`${endpoint}/ref/tags/v${version}`, { headers, signal: AbortSignal.timeout(30_000) });
        if (existing.ok) {
            const ref = await existing.json();
            if (ref.object.type !== "commit" || ref.object.sha !== sourceSha) throw new Error(`v${version} already points to another source commit`);
            console.log(`v${version} already records ${sourceSha}`);
            return;
        }
        if (existing.status !== 404) throw new Error(`Could not check release tag (HTTP ${existing.status})`);
        const created = await fetch(`${endpoint}/refs`, { method: "POST", headers, body: JSON.stringify({ ref: `refs/tags/v${version}`, sha: sourceSha }), signal: AbortSignal.timeout(30_000) });
        if (!created.ok) throw new Error(`Could not record release tag (HTTP ${created.status})`);
        console.log(`Recorded v${version} at ${sourceSha}`);
    } else throw new Error("Use plan, prepare or tag");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main(process.argv[2]);
}
