import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { activityLabel, isAssistantStreaming, shouldShowBuddyHome, shouldShowThinking, turnStatusLabel } from "./turn.js";

function message(partial: Partial<TranscriptMessage> & Pick<TranscriptMessage, "id" | "role">): TranscriptMessage {
  return {
    text: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    ...partial,
  };
}

test("thinking dots stay until the turn shows text or a tool", () => {
  const user = message({ id: "u", role: "user", text: "go" });
  const streaming = [user, message({ id: "a", role: "assistant", text: "hi", streaming: true })];
  const emptyShell = [user, message({ id: "a", role: "assistant", streaming: true })];
  const tool = [user, message({ id: "a", role: "assistant", tools: [{ name: "bash", status: "running" }] })];
  assert.equal(shouldShowThinking(true, [user]), true);
  assert.equal(shouldShowThinking(false, [user]), false);
  assert.equal(shouldShowThinking(true, emptyShell), true);
  assert.equal(shouldShowThinking(true, streaming), false);
  assert.equal(shouldShowThinking(true, tool), false);
  assert.equal(isAssistantStreaming(streaming), true);
  assert.equal(isAssistantStreaming(emptyShell), false);
});

test("activity and status labels match ChatGPT-style turn states", () => {
  assert.equal(activityLabel({ sending: true }), "正在发送…");
  assert.equal(activityLabel({ stopping: true }), "正在停止…");
  assert.equal(activityLabel({ status: "RUNNING" }), "正在思考…");
  assert.equal(activityLabel({ status: "RUNNING", runningTool: "bash" }), "正在执行 bash…");
  assert.equal(activityLabel({ status: "RUNNING", runningTool: "neo_subagent" }), "正在执行子代理…");
  assert.equal(activityLabel({ status: "RUNNING", streaming: true }), "正在回复…");
  assert.equal(activityLabel({ status: "PROVISIONING" }), "正在准备运行环境…");
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
