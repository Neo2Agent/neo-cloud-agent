import assert from "node:assert/strict";
import test from "node:test";
import {
  DESK_HOST_OFFLINE_MESSAGE,
  DESK_HOST_UNBOUND_MESSAGE,
  remoteControlSendLock,
  remoteMachineExecutionTarget,
} from "./desk.js";
import { isRemoteControlTarget } from "./run.js";

test("web or phone picking a machine is Remote Control, not This Computer", () => {
  const target = remoteMachineExecutionTarget({ deskId: "desk_1", deskWorkspaceId: "dws_1" });
  assert.equal(target.loop, "cloud");
  assert.equal(target.tools, "desk");
  assert.equal(target.remoteControl, true);
  assert.equal(isRemoteControlTarget(target), true);
});

test("cloud chats are never locked by desk presence", () => {
  assert.deepEqual(remoteControlSendLock({ executionTarget: { loop: "cloud" } }, []), {
    locked: false,
    hint: "",
  });
});

test("a Remote Control chat sends only while that desk's inbox is live", () => {
  const run = { executionTarget: { loop: "desk" as const, deskId: "desk_1" } };
  assert.deepEqual(remoteControlSendLock(run, [{ id: "desk_1", online: true }]), { locked: false, hint: "" });
  assert.deepEqual(remoteControlSendLock(run, [{ id: "desk_1", online: false }]), {
    locked: true,
    hint: DESK_HOST_OFFLINE_MESSAGE,
  });
  assert.deepEqual(remoteControlSendLock(run, []), { locked: true, hint: DESK_HOST_OFFLINE_MESSAGE });
  assert.deepEqual(remoteControlSendLock(run, [], { thisDeskId: "desk_1" }), { locked: false, hint: "" });
  assert.deepEqual(remoteControlSendLock({ executionTarget: { loop: "desk" } }, []), {
    locked: true,
    hint: DESK_HOST_UNBOUND_MESSAGE,
  });
  const cloudLoopRemote = {
    executionTarget: {
      loop: "cloud" as const,
      tools: "desk" as const,
      deskId: "desk_1",
      remoteControl: true,
    },
  };
  assert.deepEqual(remoteControlSendLock(cloudLoopRemote, [{ id: "desk_1", online: false }]), {
    locked: true,
    hint: DESK_HOST_OFFLINE_MESSAGE,
  });
  assert.deepEqual(remoteControlSendLock(cloudLoopRemote, [{ id: "desk_1", online: true }]), {
    locked: false,
    hint: "",
  });
});
