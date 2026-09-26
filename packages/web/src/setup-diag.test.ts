import assert from "node:assert/strict";
import test from "node:test";
import { workspaceNotReadyMessage } from "./setup-diag.js";

test("workspace-not-ready errors stay in Chinese", () => {
  assert.equal(workspaceNotReadyMessage(new Error("ENOENT: no such file")), "工作区还没准备好，不能开终端");
  assert.equal(workspaceNotReadyMessage(new Error("workspace missing")), "工作区还没准备好，不能开终端");
  assert.equal(workspaceNotReadyMessage(new Error("permission denied")), "permission denied");
});
