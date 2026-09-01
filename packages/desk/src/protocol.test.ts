import assert from "node:assert/strict";
import test from "node:test";
import {
  hashForInvite,
  hashForMemories,
  hashForProject,
  hashForRun,
  hashForSkills,
  inviteTokenFromDeepLink,
  inviteTokenFromHash,
  memoriesFromHash,
  parseProjectHash,
  projectIdFromHash,
  runIdFromDeepLink,
  runIdFromHash,
  skillIdFromHash,
  skillsFromHash,
} from "./protocol.js";

test("runIdFromDeepLink parses neo://runs/<id>", () => {
  assert.equal(runIdFromDeepLink("neo://runs/abc-123"), "abc-123");
  assert.equal(runIdFromDeepLink("neo://not-a-run"), null);
  assert.equal(hashForRun("abc-123"), "#/runs/abc-123");
  assert.equal(runIdFromHash("#/runs/abc-123"), "abc-123");
});

test("inviteTokenFromDeepLink parses neo://invite/<token>", () => {
  assert.equal(inviteTokenFromDeepLink("neo://invite/tok_abc"), "tok_abc");
  assert.equal(inviteTokenFromDeepLink("neo://invite/tok_abc#frag"), "tok_abc");
  assert.equal(inviteTokenFromDeepLink("neo://runs/abc-123"), null);
  assert.equal(inviteTokenFromDeepLink("https://example.com/invite/tok"), null);
  assert.equal(hashForInvite("tok_abc"), "#/invite/tok_abc");
  assert.equal(inviteTokenFromHash("#/invite/tok_abc"), "tok_abc");
  assert.equal(inviteTokenFromHash("#/runs/abc"), null);
});

test("project hash helpers", () => {
  assert.equal(hashForProject("proj_1"), "#/projects/proj_1");
  assert.equal(projectIdFromHash("#/projects/proj_1"), "proj_1");
  assert.equal(hashForProject("proj_1", { assets: true }), "#/projects/proj_1/assets");
  assert.equal(hashForProject("proj_1", { assetId: "asset_9" }), "#/projects/proj_1/assets/asset_9");
  assert.deepEqual(parseProjectHash("#/projects/proj_1/assets/asset_9"), {
    projectId: "proj_1",
    assets: true,
    assetId: "asset_9",
  });
  assert.equal(projectIdFromHash("#/projects/proj_1/assets/asset_9"), "proj_1");
});

test("skills and memories hash helpers", () => {
  assert.equal(hashForSkills(), "#/skills");
  assert.equal(hashForSkills("plug_1"), "#/skills/plug_1");
  assert.equal(skillIdFromHash("#/skills/plug_1"), "plug_1");
  assert.equal(skillsFromHash("#/skills"), true);
  assert.equal(skillsFromHash("#/skills/plug_1"), true);
  assert.equal(skillsFromHash("#/memories"), false);
  assert.equal(hashForMemories(), "#/memories");
  assert.equal(memoriesFromHash("#/memories"), true);
  assert.equal(memoriesFromHash("#/skills"), false);
});
