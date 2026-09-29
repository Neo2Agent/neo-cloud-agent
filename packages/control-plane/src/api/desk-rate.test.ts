import assert from "node:assert/strict";
import test from "node:test";
import { deskActionRatePolicies } from "./desk-rate.js";

test("a desk lease heartbeat is not charged as a write", () => {
  assert.deepEqual(deskActionRatePolicies("lease"), ["api"]);
});

test("desk claim, release, and workspace binds still spend the write bucket", () => {
  for (const action of ["claim", "reject", "release", "workspaces"]) {
    assert.deepEqual(deskActionRatePolicies(action), ["api", "write"]);
  }
});
