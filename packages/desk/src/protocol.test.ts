import assert from "node:assert/strict";
import test from "node:test";
import { hashForRun, runIdFromDeepLink } from "./protocol.js";

test("runIdFromDeepLink parses neo://runs/<id>", () => {
  assert.equal(runIdFromDeepLink("neo://runs/abc-123"), "abc-123");
  assert.equal(runIdFromDeepLink("neo://not-a-run"), null);
  assert.equal(hashForRun("abc-123"), "#/runs/abc-123");
});
