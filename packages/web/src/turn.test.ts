import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import {
  activityLabel,
  hasLiveAssistantWork,
  isActiveRunStatus,
  isComposerClosed,
  isTerminalTurnEvent,
  isTurnBusy,
  pendingUserArrived,
  shouldShowThinking,
  statusFromEventKind,
  turnStatusLabel,
  withPendingUser,
} from "./turn.js";

function message(partial: Partial<TranscriptMessage> & Pick<TranscriptMessage, "id" | "role">): TranscriptMessage {
  return {
    text: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    ...partial,
  };
}

test("isActiveRunStatus covers in-flight agent states", () => {
  assert.equal(isActiveRunStatus("RUNNING"), true);
  assert.equal(isActiveRunStatus("NOT_YET_STARTED"), true);
  assert.equal(isActiveRunStatus("WAITING_FOR_BACKGROUND_WORK"), true);
  assert.equal(isActiveRunStatus("IDLE"), false);
  assert.equal(isActiveRunStatus("ERROR"), false);
  assert.equal(isComposerClosed("ARCHIVED"), true);
  assert.equal(isComposerClosed("RUNNING"), false);
});

test("follow-up events mark an idle run running without clobbering setup", () => {
  assert.equal(statusFromEventKind("user.message", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("followup.queued", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("agent.start", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("user.message", "PROVISIONING"), null);
  assert.equal(statusFromEventKind("user.message", "INSTALLING"), null);
  assert.equal(statusFromEventKind("user.message", "ARCHIVED"), null);
  assert.equal(statusFromEventKind("agent.end", "RUNNING"), "IDLE");
  assert.equal(statusFromEventKind("agent.end", "PROVISIONING"), null);
  assert.equal(isTerminalTurnEvent("run.idle"), true);
  assert.equal(isTerminalTurnEvent("user.message"), false);
});

test("turn stays busy while sending, pending, live tools, or active status", () => {
  const streaming = [message({ id: "a", role: "assistant", text: "hi", streaming: true })];
  const tool = [message({ id: "a", role: "assistant", tools: [{ name: "bash", status: "running" }] })];
  assert.equal(isTurnBusy({ sending: true }), true);
  assert.equal(isTurnBusy({ pending: true, status: "IDLE" }), true);
  assert.equal(isTurnBusy({ status: "RUNNING" }), true);
  assert.equal(isTurnBusy({ status: "IDLE", messages: streaming }), true);
  assert.equal(isTurnBusy({ status: "IDLE", messages: tool }), true);
  assert.equal(isTurnBusy({ status: "ERROR", messages: streaming }), false);
  assert.equal(isTurnBusy({ status: "ERROR", messages: tool }), false);
  assert.equal(isTurnBusy({ status: "IDLE", messages: [message({ id: "u", role: "user", text: "go" })] }), false);
  assert.equal(hasLiveAssistantWork(tool), true);
  assert.equal(shouldShowThinking(true, streaming), false);
  assert.equal(shouldShowThinking(true, [message({ id: "u", role: "user", text: "go" })]), true);
  assert.equal(shouldShowThinking(true, [message({ id: "a", role: "assistant", text: "done" })]), false);
});

test("activity and status labels match ChatGPT-style turn states", () => {
  assert.equal(activityLabel({ sending: true }), "正在发送…");
  assert.equal(activityLabel({ stopping: true }), "正在停止…");
  assert.equal(activityLabel({ status: "RUNNING" }), "正在思考…");
  assert.equal(activityLabel({ status: "RUNNING", runningTool: "bash" }), "正在执行 bash…");
  assert.equal(activityLabel({ status: "RUNNING", streaming: true }), "正在回复…");
  assert.equal(activityLabel({ status: "PROVISIONING" }), "正在准备运行环境…");
  assert.deepEqual(turnStatusLabel({ sending: true, status: "IDLE" }), { state: "RUNNING", label: "发送中" });
  assert.deepEqual(turnStatusLabel({ status: "RUNNING" }), { state: "RUNNING", label: "运行中" });
  assert.equal(turnStatusLabel({ status: null }).label, "就绪");
});

test("withPendingUser shows an optimistic bubble until the real event arrives", () => {
  const pending = { id: "pending-1", text: "继续", createdAt: "2026-08-22T00:00:10.000Z" };
  const before = withPendingUser([], pending);
  assert.equal(before.at(-1)?.id, "pending-1");
  const arrived = [
    message({ id: "real", role: "user", text: "继续", createdAt: "2026-08-22T00:00:11.000Z" }),
  ];
  assert.equal(withPendingUser(arrived, pending).length, 1);
  assert.equal(pendingUserArrived(arrived, pending), true);
  assert.equal(pendingUserArrived([], pending), false);
});
