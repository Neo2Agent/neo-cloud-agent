import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, TranscriptMessage } from "./events.js";
import { applyRunEventsToMessages } from "./transcript.js";
import {
  appendPendingUser,
  assistantIsLive,
  dropResolvedPendingUsers,
  hasLiveAssistantWork,
  isActiveRunStatus,
  isComposerClosed,
  isTerminalTurnEvent,
  isTurnBusy,
  liveAssistantId,
  mergeUnresolvedPending,
  pendingUserArrived,
  QUEUED_SLOT_NOTICE,
  runningToolName,
  shouldRefreshTranscript,
  statusFromEventKind,
  withPendingUser,
  withQueuedNotice,
} from "./turn-state.js";

function message(partial: Partial<TranscriptMessage> & Pick<TranscriptMessage, "id" | "role">): TranscriptMessage {
  return { text: "", createdAt: "2026-08-22T00:00:00.000Z", ...partial };
}

function ev(partial: Partial<RunEvent> & Pick<RunEvent, "id" | "kind">): RunEvent {
  return {
    runId: "run-1",
    createdAt: "2026-08-21T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    title: partial.kind,
    ...partial,
  };
}

test("run statuses and terminal events", () => {
  assert.equal(isActiveRunStatus("RUNNING"), true);
  assert.equal(isActiveRunStatus("NOT_YET_STARTED"), true);
  assert.equal(isActiveRunStatus("WAITING_FOR_BACKGROUND_WORK"), true);
  assert.equal(isActiveRunStatus("IDLE"), false);
  assert.equal(isActiveRunStatus("ERROR"), false);
  assert.equal(isComposerClosed("ARCHIVED"), true);
  assert.equal(isComposerClosed("RUNNING"), false);
  assert.equal(isTerminalTurnEvent("run.idle"), true);
  assert.equal(isTerminalTurnEvent("agent.end"), false);
  assert.equal(isTerminalTurnEvent("user.message"), false);
});

test("statusFromEventKind marks follow-ups running without clobbering setup", () => {
  assert.equal(statusFromEventKind("user.message", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("followup.queued", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("followup.delivered", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("followup.queued", "RUNNING"), null);
  assert.equal(statusFromEventKind("agent.start", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("user.message", "PROVISIONING"), null);
  assert.equal(statusFromEventKind("user.message", "ARCHIVED"), null);
  assert.equal(statusFromEventKind("agent.end", "RUNNING"), "IDLE");
  assert.equal(statusFromEventKind("agent.end", "PROVISIONING"), null);
  assert.equal(statusFromEventKind("run.queued"), "NOT_YET_STARTED");
  assert.equal(statusFromEventKind("run.provisioning"), "PROVISIONING");
  assert.equal(statusFromEventKind("run.idle", "RUNNING"), "IDLE");
  assert.equal(statusFromEventKind("run.error", "RUNNING"), "ERROR");
  assert.equal(statusFromEventKind("scm.clone_failed", "PROVISIONING"), "ERROR");
  assert.equal(isTerminalTurnEvent("scm.clone_failed"), true);
  assert.equal(statusFromEventKind("run.deleted"), "ARCHIVED");
  assert.equal(statusFromEventKind("tool.start", "RUNNING"), null);
});

test("a running tool keeps the turn live after message.end clears streaming", () => {
  const live = applyRunEventsToMessages([], [
    ev({ id: "u1", kind: "user.message", data: { text: "pwd" } }),
    ev({ id: "a1", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.delta", data: { delta: "我来看一下" } }),
    ev({ id: "e1", kind: "message.end" }),
    ev({ id: "t1", kind: "tool.start", data: { toolCallId: "bash-1", toolName: "bash", args: { command: "pwd" } } }),
  ]);
  const assistant = live.find((item) => item.role === "assistant");
  assert.ok(assistant);
  assert.equal(assistant.streaming, false);
  assert.equal(assistantIsLive(assistant), true);
  assert.equal(runningToolName(live), "bash");
  assert.equal(hasLiveAssistantWork(live), true);
  assert.equal(liveAssistantId(live, false), assistant.id);
});

test("liveAssistantId covers the gap between a text burst and the next tool", () => {
  const idle = message({ id: "a1", role: "assistant", text: "我来看一下", streaming: false });
  const turn = [message({ id: "u1", role: "user", text: "pwd" }), idle];
  assert.equal(assistantIsLive(idle), false);
  assert.equal(liveAssistantId(turn, true), "a1");
  assert.equal(liveAssistantId(turn, false), null);
  assert.equal(liveAssistantId([message({ id: "u1", role: "user", text: "pwd" })], true), null);
  const empty = message({ id: "a2", role: "assistant", streaming: true });
  assert.equal(assistantIsLive(empty), true);
});

test("the previous turn is never live once a new user message lands", () => {
  const messages = [
    message({ id: "old", role: "assistant", tools: [{ name: "ls", status: "running" }] }),
    message({ id: "u", role: "user", text: "继续" }),
    message({ id: "a", role: "assistant", text: "好的" }),
  ];
  assert.equal(hasLiveAssistantWork(messages), false);
  assert.equal(runningToolName(messages), null);
  assert.equal(liveAssistantId(messages, false), null);
});

test("turn stays busy while sending, pending, live tools, or active status", () => {
  const streaming = [message({ id: "a", role: "assistant", text: "hi", streaming: true })];
  const tool = [message({ id: "a", role: "assistant", tools: [{ name: "bash", status: "running" }] })];
  assert.equal(isTurnBusy({ sending: true }), true);
  assert.equal(isTurnBusy({ pending: true, status: "IDLE" }), true);
  assert.equal(isTurnBusy({ status: "RUNNING" }), true);
  assert.equal(isTurnBusy({ status: "IDLE", messages: streaming }), true);
  assert.equal(isTurnBusy({ status: "IDLE", messages: tool }), true);
  assert.equal(isTurnBusy({ status: "ERROR", messages: tool }), false);
  assert.equal(isTurnBusy({ status: "IDLE", messages: [message({ id: "u", role: "user", text: "go" })] }), false);
});

test("pending user bubble stays until a newer confirmed one arrives", () => {
  const pending = { id: "pending-1", text: "继续", createdAt: "2026-08-28T00:00:10.000Z" };
  const earlier = message({ id: "u0", role: "user", text: "继续", createdAt: "2026-08-28T00:00:00.000Z" });
  assert.equal(withPendingUser([], pending).at(-1)?.id, "pending-1");
  assert.equal(pendingUserArrived([earlier], pending), false);
  const withHistory = appendPendingUser([earlier], pending);
  assert.deepEqual(withHistory.map((item) => item.id), ["u0", "pending-1"]);
  const echoed = message({ id: "u1", role: "user", text: "继续", createdAt: "2026-08-28T00:00:08.000Z" });
  assert.equal(pendingUserArrived([echoed], pending), true);
  assert.deepEqual(mergeUnresolvedPending([earlier], withHistory).map((item) => item.id), ["u0", "pending-1"]);
  assert.deepEqual(
    dropResolvedPendingUsers([...withHistory, echoed]).map((item) => item.id),
    ["u0", "u1"],
  );
});

test("queued notice and snapshot polling", () => {
  assert.equal(shouldRefreshTranscript({ lastSseAt: Date.now(), status: "NOT_YET_STARTED" }), true);
  assert.equal(shouldRefreshTranscript({ lastSseAt: Date.now(), status: "RUNNING" }), false);
  assert.equal(shouldRefreshTranscript({ lastSseAt: 0, now: 4000, status: "RUNNING" }), true);
  const first = withQueuedNotice([], "NOT_YET_STARTED", "2026-08-29T00:00:00.000Z");
  assert.equal(first.at(-1)?.text, QUEUED_SLOT_NOTICE);
  assert.equal(withQueuedNotice(first, "NOT_YET_STARTED").length, 1);
  assert.equal(withQueuedNotice(first, "RUNNING").length, 1);
});
