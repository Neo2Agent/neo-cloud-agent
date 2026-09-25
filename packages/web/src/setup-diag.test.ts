import assert from "node:assert/strict";
import test from "node:test";
import { inspectorOpenForDiagnostics, shouldAutoOpenPty, workspaceNotReadyMessage } from "./setup-diag.js";

test("diagnostics open the terminal pane on Setup, not a PTY", () => {
  assert.deepEqual(inspectorOpenForDiagnostics(), { tab: "terminal", intent: "setup" });
  assert.equal(shouldAutoOpenPty("setup"), false);
  assert.equal(shouldAutoOpenPty("shell"), true);
});

test("workspace-not-ready errors stay in Chinese", () => {
  assert.equal(workspaceNotReadyMessage(new Error("ENOENT: no such file")), "工作区还没准备好，不能开终端");
  assert.equal(workspaceNotReadyMessage(new Error("workspace missing")), "工作区还没准备好，不能开终端");
  assert.equal(workspaceNotReadyMessage(new Error("permission denied")), "permission denied");
});
