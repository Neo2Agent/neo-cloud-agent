import assert from "node:assert/strict";
import test from "node:test";
import {
  BUNDLED_EXPERTS,
  BUNDLED_EXPERT_TEAMS,
  appendExpertRole,
  applyBundledExpertOverride,
  bundledExpertById,
  bundledTeamById,
  canAccessBundledExpertPolicy,
  canEditExpert,
  canUseExpert,
  decodeExpertPick,
  defaultBundledExpertPolicyEntry,
  encodeExpertPick,
  expertBodyLength,
  expertVisibilityLabel,
  intersectSessionTools,
  parseExpertWorkspaceMeta,
  renderExpertRole,
  renderMemberAgentMarkdown,
  renderTeamLeadRole,
  slugifyExpertName,
  sortExpertsForPicker,
} from "./expert.js";

test("bundled experts have stable ids and role override", () => {
  assert.equal(bundledExpertById("exp_reviewer")?.slug, "reviewer");
  assert.equal(bundledExpertById("security")?.id, "exp_security");
  assert.match(renderExpertRole(bundledExpertById("exp_reviewer")!), /Role Override/);
  assert.match(renderExpertRole(bundledExpertById("exp_reviewer")!), /takes precedence/);
  assert.ok(BUNDLED_EXPERTS.every((item) => item.visibility === "bundled"));
  assert.ok(expertBodyLength(bundledExpertById("exp_reviewer")!) > 40);
});

test("bundled teams reference real member slugs", () => {
  for (const team of BUNDLED_EXPERT_TEAMS) {
    assert.ok(team.tools?.includes("neo_subagent"));
    for (const slug of team.memberSlugs) {
      assert.ok(bundledExpertById(slug), `missing member ${slug}`);
    }
  }
  const ship = bundledTeamById("ship-change");
  assert.ok(ship);
  const members = ship.memberSlugs.map((slug) => bundledExpertById(slug)!);
  assert.match(renderTeamLeadRole(ship, members), /Role Override/);
  assert.match(renderTeamLeadRole(ship, members), /planner/);
  assert.match(renderMemberAgentMarkdown(members[0]!), /name: planner/);
});

test("appendExpertRole and tool intersect", () => {
  assert.equal(appendExpertRole("base", ""), "base");
  assert.match(appendExpertRole("base", "You are reviewer"), /Active expert role/);
  assert.deepEqual(intersectSessionTools(["read", "write", "bash"], ["read", "bash"]), ["read", "bash"]);
  assert.deepEqual(intersectSessionTools(["read", "write"], undefined), ["read", "write"]);
});

test("access and picker sort", () => {
  const user = bundledExpertById("exp_reviewer")!;
  assert.equal(canEditExpert(user, { userId: "u1" }), false);
  assert.equal(canUseExpert(user, { userId: "u1" }), true);
  const mine = {
    ...user,
    id: "exp_mine",
    visibility: "user" as const,
    ownerUserId: "u1",
  };
  assert.equal(canEditExpert(mine, { userId: "u1" }), true);
  assert.equal(canUseExpert(mine, { userId: "u2" }), false);
  const sorted = sortExpertsForPicker([user, mine], ["exp_reviewer"]);
  assert.equal(sorted[0]?.id, "exp_reviewer");
  assert.match(slugifyExpertName("安全审查"), /^expert-/);
  assert.match(slugifyExpertName("Code Review"), /^code-review$/);
  assert.equal(
    parseExpertWorkspaceMeta(JSON.stringify({ id: "exp_reviewer", slug: "reviewer", name: "审查", kind: "expert" }))
      ?.slug,
    "reviewer",
  );
  assert.equal(parseExpertWorkspaceMeta("{}"), null);
  assert.equal(encodeExpertPick({ expertId: "exp_reviewer" }), "expert:exp_reviewer");
  assert.deepEqual(decodeExpertPick("team:team_ship_change"), { expertTeamId: "team_ship_change" });
  assert.deepEqual(decodeExpertPick("neo"), {});
  assert.equal(expertVisibilityLabel("bundled"), "内置");
});

test("bundled expert policy override and access", () => {
  const base = bundledExpertById("exp_reviewer")!;
  const live = applyBundledExpertOverride(base, {
    name: "审查加强",
    title: null,
    persona: "You review diffs only.",
    tools: ["read", "grep"],
  });
  assert.equal(live.name, "审查加强");
  assert.equal(live.title, undefined);
  assert.equal(live.persona, "You review diffs only.");
  assert.deepEqual(live.tools, ["read", "grep"]);
  assert.equal(live.methodology, base.methodology);
  const open = defaultBundledExpertPolicyEntry();
  assert.equal(canAccessBundledExpertPolicy(open, "u1"), true);
  assert.equal(canAccessBundledExpertPolicy({ ...open, enabled: false }, "u1"), false);
  assert.equal(canAccessBundledExpertPolicy({ ...open, audience: "allowlist", userIds: ["u2"] }, "u1"), false);
  assert.equal(canAccessBundledExpertPolicy({ ...open, audience: "allowlist", userIds: ["u2"] }, "u2"), true);
  assert.equal(canAccessBundledExpertPolicy({ ...open, audience: "allowlist", userIds: ["u2"] }, undefined), true);
});
