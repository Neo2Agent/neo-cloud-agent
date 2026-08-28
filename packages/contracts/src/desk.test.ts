import assert from "node:assert/strict";
import test from "node:test";
import { DESK_HOST_OFFLINE_MESSAGE, DESK_HOST_UNBOUND_MESSAGE, remoteControlSendLock } from "./desk.js";

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
});
