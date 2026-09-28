import assert from "node:assert/strict";
import test from "node:test";
import { DESK_HOST_OFFLINE_MESSAGE, REMOTE_CLOUD_CONTINUE_STATUS } from "@neo-cloud-agent/contracts/desk";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { chatStatusText, composerGate, runRowMeta } from "./session.js";

const remote: Run = {
  id: "r1",
  prompt: "follow desk",
  status: "IDLE",
  remoteUrl: "https://github.com/acme/app.git",
  baseBranch: "feat/login",
  executionTarget: { loop: "cloud", tools: "desk", deskId: "desk_1", remoteControl: true },
} as Run;

test("composerGate locks Remote follow-up when the host is offline", () => {
  const gate = composerGate(remote, [{ id: "desk_1", online: false }]);
  assert.equal(gate.locked, true);
  assert.equal(gate.hint, gate.continueCopy.composerHint);
  assert.equal(gate.cloudContinue.show, true);
  assert.equal(gate.cloudContinue.branch, "feat/login");
  assert.equal(gate.continueCopy.repoLine, "acme/app · feat/login");
});

test("composerGate stays open for cloud runs", () => {
  const gate = composerGate({ ...remote, executionTarget: { loop: "cloud", tools: "cloud" } }, []);
  assert.equal(gate.locked, false);
});

test("composerGate locks This Computer follow-up when the host is offline", () => {
  const local = { ...remote, executionTarget: { loop: "desk" as const, tools: "desk" as const, deskId: "desk_1" } };
  const gate = composerGate(local, [{ id: "desk_1", online: false }]);
  assert.equal(gate.locked, true);
  assert.equal(gate.hint, DESK_HOST_OFFLINE_MESSAGE);
});

test("runRowMeta labels cloud vs remote without a color pill", () => {
  assert.match(runRowMeta({ ...remote, executionTarget: { loop: "cloud", tools: "cloud" } }), /云端/);
  assert.match(runRowMeta(remote), /Remote/);
});

test("chatStatusText prefers Desk 离线 over 跑着 when the host is gone", () => {
  assert.equal(chatStatusText(remote, [{ id: "desk_1", online: false }]), REMOTE_CLOUD_CONTINUE_STATUS);
  assert.equal(
    chatStatusText({ ...remote, status: "RUNNING" }, [{ id: "desk_1", online: false }]),
    REMOTE_CLOUD_CONTINUE_STATUS,
  );
});
