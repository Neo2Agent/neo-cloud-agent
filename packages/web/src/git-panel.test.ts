import assert from "node:assert/strict";
import test from "node:test";
import { gitPanelCanCommit } from "./git-panel.ts";

test("git panel commits on cloud, and on Desk for laptop files", () => {
  assert.equal(gitPanelCanCommit({ context: "cloud", deskApp: false, dirty: true }), true);
  assert.equal(gitPanelCanCommit({ context: "cloud", deskApp: true, dirty: true }), true);
  assert.equal(gitPanelCanCommit({ context: "desk", deskApp: true, dirty: true }), true);
  assert.equal(gitPanelCanCommit({ context: "desk", deskApp: false, dirty: true }), false);
  assert.equal(gitPanelCanCommit({ context: "desk", deskApp: true, dirty: false }), false);
});
