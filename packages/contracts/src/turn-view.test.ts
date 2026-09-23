import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptMessage } from "./events.js";
import { activityLabel, isAssistantStreaming, messageTimeLabel, shouldShowThinking } from "./turn-view.js";

function message(partial: Partial<TranscriptMessage> & Pick<TranscriptMessage, "id" | "role">): TranscriptMessage {
  return {
    text: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    ...partial,
  };
}

test("thinking shows until the current turn has text or a tool", () => {
  const user = message({ id: "u", role: "user", text: "go" });
  const earlier = message({ id: "a0", role: "assistant", text: "old reply" });
  const streaming = [user, message({ id: "a", role: "assistant", text: "hi", streaming: true })];
  const emptyShell = [user, message({ id: "a", role: "assistant", streaming: true })];
  const running = [user, message({ id: "a", role: "assistant", tools: [{ name: "bash", status: "running" }] })];
  const doneTool = [user, message({ id: "a", role: "assistant", tools: [{ name: "bash", status: "done" }] })];
  assert.equal(shouldShowThinking(true, [user]), true);
  assert.equal(shouldShowThinking(false, [user]), false);
  assert.equal(shouldShowThinking(true, [earlier, user]), true);
  assert.equal(shouldShowThinking(true, emptyShell), true);
  assert.equal(shouldShowThinking(true, streaming), false);
  assert.equal(shouldShowThinking(true, running), false);
  assert.equal(shouldShowThinking(true, doneTool), false);
  assert.equal(isAssistantStreaming(streaming), true);
  assert.equal(isAssistantStreaming(emptyShell), false);
});

test("activity labels follow setup, tools, and streaming", () => {
  assert.equal(activityLabel({ sending: true }), "正在发送…");
  assert.equal(activityLabel({ stopping: true }), "正在停止…");
  assert.equal(activityLabel({ status: "RUNNING" }), "正在思考…");
  assert.equal(activityLabel({ status: "RUNNING", runningTool: "bash" }), "正在执行 bash…");
  assert.equal(activityLabel({ status: "RUNNING", runningTool: "neo_subagent" }), "正在执行子代理…");
  assert.equal(activityLabel({ status: "RUNNING", streaming: true }), "正在回复…");
  assert.equal(activityLabel({ status: "PROVISIONING" }), "正在准备运行环境…");
  assert.equal(activityLabel({ status: "NOT_YET_STARTED" }), "排队等待空闲 VM…");
});

test("a live assistant message has no time; a settled one shows time and duration", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const reply = message({
    id: "a",
    role: "assistant",
    createdAt: "2026-08-24T09:30:00.000Z",
    updatedAt: "2026-08-24T09:30:12.000Z",
  });
  assert.equal(messageTimeLabel(reply, { live: true, now }), null);
  assert.equal(messageTimeLabel(reply, { now }), "8/24 17:30 · 12s");
  assert.equal(messageTimeLabel(reply, { withDuration: false, now }), "8/24 17:30");
  const long = { ...reply, updatedAt: "2026-08-24T10:05:00.000Z" };
  assert.equal(messageTimeLabel(long, { withDuration: false, now }), "8/24 17:30 · 完成 8/24 18:05");
  const user = message({ id: "u", role: "user", createdAt: "2026-08-24T09:30:00.000Z" });
  assert.equal(messageTimeLabel(user, { live: true, now }), "8/24 17:30");
});
