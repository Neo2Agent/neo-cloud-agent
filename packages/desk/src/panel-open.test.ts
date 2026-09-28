import assert from "node:assert/strict";
import test from "node:test";
import { shouldRestoreDeskPanel } from "./panel-open.js";

test("empty Files / Home does not come back open and steal the chat column", () => {
  assert.equal(shouldRestoreDeskPanel({ storedOpen: false, tab: "files" }), false);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "files" }), false);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "home" }), false);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "files", folder: "" }), false);
});

test("a workspace or a working tab can restore the right pane", () => {
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "files", folder: "/tmp/repo" }), true);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "home", runId: "run_1" }), true);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "git" }), true);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "artifacts" }), true);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "terminal" }), true);
});
