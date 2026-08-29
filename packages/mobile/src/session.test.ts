import assert from "node:assert/strict";
import test from "node:test";
import { DESK_HOST_OFFLINE_MESSAGE } from "@neo-cloud-agent/contracts/desk";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { chatStatusText, composerGate, runRowMeta } from "./session.js";

const remote: Run = {
  id: "r1",
  prompt: "follow desk",
  status: "IDLE",
  executionTarget: { loop: "desk", tools: "desk", deskId: "desk_1", remoteControl: true },
} as Run;

test("composerGate locks Remote follow-up when the host is offline", () => {
  const gate = composerGate(remote, [{ id: "desk_1", online: false }]);
  assert.equal(gate.locked, true);
  assert.equal(gate.hint, DESK_HOST_OFFLINE_MESSAGE);
});

test("composerGate stays open for cloud runs", () => {
  const gate = composerGate({ ...remote, executionTarget: { loop: "cloud", tools: "cloud" } }, []);
  assert.equal(gate.locked, false);
});

test("runRowMeta labels cloud vs remote without a color pill", () => {
  assert.match(runRowMeta({ ...remote, executionTarget: { loop: "cloud", tools: "cloud" } }), /cloud/);
  assert.match(runRowMeta(remote), /remote/);
});

test("chatStatusText prefers the offline host hint", () => {
  assert.equal(chatStatusText(remote, [{ id: "desk_1", online: false }]), DESK_HOST_OFFLINE_MESSAGE);
});
