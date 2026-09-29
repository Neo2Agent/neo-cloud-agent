import assert from "node:assert/strict";
import test from "node:test";
import { shouldRestoreDeskPanel } from "./panel-open.js";

test("a chat opens like Web: the right inspector stays closed", () => {
  assert.equal(shouldRestoreDeskPanel({ storedOpen: false, tab: "files" }), false);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "terminal" }), false);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "git" }), false);
  assert.equal(shouldRestoreDeskPanel({ storedOpen: true, tab: "files", folder: "/tmp/repo", runId: "run_1" }), false);
});
