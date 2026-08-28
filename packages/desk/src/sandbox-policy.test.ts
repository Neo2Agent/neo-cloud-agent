import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OUT_OF_WORKSPACE_POLICY, normalizeOutOfWorkspacePolicy } from "./sandbox-policy.js";

test("out-of-workspace policy stays deny, including reserved names", () => {
  assert.equal(DEFAULT_OUT_OF_WORKSPACE_POLICY, "deny");
  assert.equal(normalizeOutOfWorkspacePolicy("deny"), "deny");
  assert.equal(normalizeOutOfWorkspacePolicy("ask"), "deny");
  assert.equal(normalizeOutOfWorkspacePolicy("allowlist"), "deny");
  assert.equal(normalizeOutOfWorkspacePolicy(undefined), "deny");
  assert.equal(normalizeOutOfWorkspacePolicy("anything"), "deny");
});
