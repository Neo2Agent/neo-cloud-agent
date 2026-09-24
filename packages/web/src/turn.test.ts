import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowBuddyHome, turnStatusLabel } from "./turn.js";

test("status labels match ChatGPT-style turn states", () => {
  assert.deepEqual(turnStatusLabel({ sending: true, status: "IDLE" }), { state: "RUNNING", label: "发送中" });
  assert.deepEqual(turnStatusLabel({ status: "RUNNING" }), { state: "RUNNING", label: "运行中" });
  assert.equal(turnStatusLabel({ status: null }).label, "就绪");
});

test("shouldShowBuddyHome hides the welcome screen after send", () => {
  assert.equal(shouldShowBuddyHome({ narrow: true, runId: null }), true);
  assert.equal(shouldShowBuddyHome({ narrow: true, runId: null, pending: true }), false);
  assert.equal(shouldShowBuddyHome({ narrow: true, runId: null, messageCount: 1 }), false);
  assert.equal(shouldShowBuddyHome({ narrow: false, runId: null }), false);
});
