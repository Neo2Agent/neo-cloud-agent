import assert from "node:assert/strict";
import test from "node:test";
import {
  hashForInvite,
  hashForProject,
  hashForRun,
  inviteTokenFromDeepLink,
  inviteTokenFromHash,
  projectIdFromHash,
  runIdFromDeepLink,
  runIdFromHash,
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
});
