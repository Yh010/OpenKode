import assert from "node:assert/strict";
import test from "node:test";
import { releasePlan, parseVersion } from "../release-version.mjs";

const sha = "a".repeat(40);
const metadata = versions => ({ name: "openkode", versions: Object.fromEntries(versions.map(version => [version, {}])) });

test("main releases increment the highest published stable patch, even if latest is stale", () => {
    assert.deepEqual(releasePlan({ ...metadata(["1.0.0", "1.0.9", "1.0.2", "0.0.0-stage", "2.0.0-beta.1"]), "dist-tags": { latest: "1.0.0" } }, "1.0.0", sha), { version: "1.0.10", publish: true });
});
test("intentional new major or minor versions are retained", () => {
    assert.deepEqual(releasePlan(metadata(["1.0.9"]), "2.0.0", sha), { version: "2.0.0", publish: true });
    assert.deepEqual(releasePlan(metadata(["1.0.9"]), "1.1.0", sha), { version: "1.1.0", publish: true });
});
test("rerunning a published commit reuses its version without another publish", () => {
    const data = metadata(["1.0.0", "1.0.1", "1.0.2"]);
    data.versions["1.0.1"].gitHead = sha;
    assert.deepEqual(releasePlan(data, "1.0.0", sha), { version: "1.0.1", publish: false });
    assert.deepEqual(releasePlan(data, "1.0.0", "b".repeat(40)), { version: "1.0.3", publish: true });
});
test("invalid registry data, unsafe versions and missing source commits stop release planning", () => {
    for (const value of [undefined, "1.2", "01.2.3", "1.2.3-beta.1", "1.2.3\npublish=true", "1.2.9007199254740992"]) assert.throws(() => parseVersion(value));
    for (const data of [{}, { name: "another-package", versions: {} }, { name: "openkode", versions: [] }]) assert.throws(() => releasePlan(data, "1.0.0", sha));
    assert.throws(() => releasePlan(metadata(["1.0.0"]), "1.0.0", "missing"));
    assert.throws(() => releasePlan(metadata(["1.0.9007199254740991"]), "1.0.0", sha));
});
