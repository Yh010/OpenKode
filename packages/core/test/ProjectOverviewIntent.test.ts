import assert from "node:assert/strict";
import test from "node:test";
import { isProjectOverviewRequest } from "../src/agent/OpenKodeAgent.js";

test("recognizes project overview questions as repository research", () => {
    assert.equal(isProjectOverviewRequest("what is this project about?"), true);
    assert.equal(isProjectOverviewRequest("Describe this repository"), true);
    assert.equal(isProjectOverviewRequest("where is binarySearch implemented?"), false);
});
