import assert from "node:assert/strict";
import test from "node:test";
import {
  DESK_HOST_OFFLINE_MESSAGE,
  DESK_HOST_UNBOUND_MESSAGE,
  REMOTE_CLOUD_CONTINUE_ACTION,
  REMOTE_CLOUD_CONTINUE_STATUS,
  REMOTE_CLOUD_CONTINUE_WARNING,
  remoteCloudContinueCopy,
  remoteCloudContinueOffer,
  remoteControlSendLock,
} from "./desk.js";

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

test("continue-in-cloud is only for an offline Remote with a recorded origin", () => {
  const remote = {
    remoteUrl: "https://github.com/acme/app.git",
    baseBranch: "feat/login",
    executionTarget: {
      loop: "cloud" as const,
      tools: "desk" as const,
      deskId: "desk_1",
      remoteControl: true,
    },
  };
  assert.deepEqual(remoteCloudContinueOffer(remote, [{ id: "desk_1", online: true }]), {
    show: false,
    remoteUrl: "",
    branch: "",
  });
  assert.deepEqual(remoteCloudContinueOffer(remote, [{ id: "desk_1", online: false }]), {
    show: true,
    remoteUrl: "https://github.com/acme/app.git",
    branch: "feat/login",
  });
  assert.equal(
    remoteCloudContinueOffer(
      { ...remote, executionTarget: { loop: "desk", tools: "desk", deskId: "desk_1" } },
      [{ id: "desk_1", online: false }],
    ).show,
    false,
  );
  assert.equal(remoteCloudContinueOffer({ ...remote, remoteUrl: null, repoUrls: ["/tmp/app"] }, []).show, false);
});

test("offline continue copy names the repo and keeps the unpushed warning off the send bar", () => {
  const copy = remoteCloudContinueCopy({
    remoteUrl: "https://github.com/acme/app.git",
    branch: "feat/login",
  });
  assert.equal(copy.title, "Desk 离线");
  assert.equal(copy.repoLine, "acme/app · feat/login");
  assert.equal(copy.warning, REMOTE_CLOUD_CONTINUE_WARNING);
  assert.equal(copy.action, REMOTE_CLOUD_CONTINUE_ACTION);
  assert.equal(copy.status, REMOTE_CLOUD_CONTINUE_STATUS);
  assert.match(copy.confirmMessage, /acme\/app · feat\/login/);
  assert.match(copy.composerHint, /Desk 离线/);
});
