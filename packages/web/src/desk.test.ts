import assert from "node:assert/strict";
import test from "node:test";
import { isRemoteControlTarget } from "@neo-cloud-agent/contracts/run";
import { webMachineRunTarget } from "./desk.js";

test("browser machine target is Remote Control so Web and Mobile stay on the chat", () => {
  assert.equal(webMachineRunTarget({ kind: "desk" }), null);
  const target = webMachineRunTarget({ kind: "desk", deskId: "desk_1", workspaceId: "dws_1" });
  assert.ok(target);
  assert.equal(isRemoteControlTarget(target), true);
  assert.equal(target.deskWorkspaceId, "dws_1");
});
