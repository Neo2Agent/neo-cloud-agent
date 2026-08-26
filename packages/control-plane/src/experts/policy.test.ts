import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-expert-policy-"));

const {
  canAccessBundledExpert,
  configureBundledExpert,
  mergeBundledExpert,
  publishBundledExpert,
  resetBundledExpert,
  resetBundledExpertPolicyForTests,
} = await import("./policy.js");
const { listExpertsForActor, requireUsableExpert } = await import("./store.js");

test("admin can configure and publish bundled experts", () => {
  resetBundledExpertPolicyForTests();
  try {
  configureBundledExpert("reviewer", {
    name: "审查加强",
    persona: "You only review diffs.",
    tools: ["read", "grep"],
  });
  const live = mergeBundledExpert("exp_reviewer");
  assert.equal(live?.name, "审查加强");
  assert.equal(live?.persona, "You only review diffs.");
  assert.deepEqual(live?.tools, ["read", "grep"]);

  configureBundledExpert("exp_reviewer", { enabled: false });
  assert.equal(canAccessBundledExpert("exp_reviewer", "user_a"), false);
  assert.throws(() => requireUsableExpert("exp_reviewer", { userId: "user_a" }), /不能使用这个专家/);

  configureBundledExpert("exp_reviewer", { enabled: true });
  publishBundledExpert("exp_reviewer", { audience: "allowlist", userIds: ["user_b"] });
  assert.equal(canAccessBundledExpert("exp_reviewer", "user_a"), false);
  assert.equal(canAccessBundledExpert("exp_reviewer", "user_b"), true);
  const listed = listExpertsForActor({ userId: "user_a" });
  assert.equal(listed.some((item) => item.id === "exp_reviewer"), false);
  assert.equal(listExpertsForActor({ userId: "user_b" }).some((item) => item.id === "exp_reviewer"), true);

  resetBundledExpert("exp_reviewer");
  assert.equal(mergeBundledExpert("exp_reviewer")?.name, "审查");
  assert.equal(canAccessBundledExpert("exp_reviewer", "user_a"), false);
  resetBundledExpert("exp_reviewer", { grants: true });
  assert.equal(canAccessBundledExpert("exp_reviewer", "user_a"), true);
  } finally {
    resetBundledExpertPolicyForTests();
  }
});
