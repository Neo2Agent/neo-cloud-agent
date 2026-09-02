import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPendingUser,
  DESK_STARTING_NOTICE,
  generationStarted,
  hasVisibleTranscript,
  isStartupWhisper,
  mergeUnresolvedPending,
  pendingUserArrived,
  pendingUserMessage,
  QUEUED_SLOT_NOTICE,
  sendFailureMessage,
  shouldRefreshTranscript,
  runCursorChanged,
  shouldReplaceLiveTranscript,
  shouldShowThinking,
  thinkingHint,
  withPendingUser,
  withQueuedNotice,
} from "./turn.js";

test("pendingUserMessage shows the typed text immediately", () => {
  const message = pendingUserMessage("你好", "2026-08-29T00:00:00.000Z");
  assert.equal(message.role, "user");
  assert.equal(message.text, "你好");
  assert.equal(message.id, "pending-2026-08-29T00:00:00.000Z");
});

test("optimistic user bubble stays until the server event arrives", () => {
  const pending = pendingUserMessage("测试", "2026-08-30T00:00:00.000Z");
  const shown = appendPendingUser([], pending);
  assert.equal(shown[0]?.text, "测试");
  assert.equal(withPendingUser([], pending).length, 1);
  const arrived = [{ id: "e1", role: "user" as const, text: "测试", createdAt: "2026-08-30T00:00:01.000Z" }];
  assert.equal(pendingUserArrived(arrived, pending), true);
  assert.equal(mergeUnresolvedPending(arrived, shown).length, 1);
  assert.equal(mergeUnresolvedPending([], shown)[0]?.id, pending.id);
});

test("shouldRefreshTranscript polls while queued or when SSE is quiet", () => {
  assert.equal(shouldRefreshTranscript({ lastSseAt: Date.now(), status: "NOT_YET_STARTED" }), true);
  assert.equal(shouldRefreshTranscript({ lastSseAt: Date.now(), status: "RUNNING" }), false);
  assert.equal(shouldRefreshTranscript({ lastSseAt: 0, now: 4000, status: "RUNNING" }), true);
});

test("runCursorChanged is false when the run record is unchanged", () => {
  assert.equal(
    runCursorChanged(
      { updatedAt: "2026-09-02T08:18:35.756Z", status: "RUNNING" },
      { updatedAt: "2026-09-02T08:18:35.756Z", status: "RUNNING" },
    ),
    false,
  );
  assert.equal(
    runCursorChanged({ updatedAt: "t1", status: "RUNNING" }, { updatedAt: "t1", status: "IDLE" }),
    true,
  );
});

test("live SSE tokens are not replaced by a GET snapshot", () => {
  assert.equal(shouldReplaceLiveTranscript({ liveSse: true, lastSseAt: Date.now() }), false);
  assert.equal(shouldReplaceLiveTranscript({ liveSse: true, lastSseAt: 0, now: 5000 }), true);
  assert.equal(shouldReplaceLiveTranscript({ liveSse: false, lastSseAt: Date.now() }), true);
});

test("withQueuedNotice inserts the slot-wait line once", () => {
  const first = withQueuedNotice([], "NOT_YET_STARTED", "2026-08-29T00:00:00.000Z");
  assert.equal(first.at(-1)?.text, QUEUED_SLOT_NOTICE);
  assert.equal(withQueuedNotice(first, "NOT_YET_STARTED").length, 1);
});

test("empty assistant shells stay hidden until tokens or tools arrive", () => {
  assert.equal(
    hasVisibleTranscript({ id: "a1", role: "assistant", text: "", createdAt: "t", streaming: true }),
    false,
  );
  assert.equal(hasVisibleTranscript({ id: "a2", role: "assistant", text: "好", createdAt: "t" }), true);
  assert.equal(
    hasVisibleTranscript({
      id: "a3",
      role: "assistant",
      text: "",
      createdAt: "t",
      tools: [{ name: "bash", status: "running" }],
    }),
    true,
  );
});

test("shouldShowThinking fills the wait until text or a tool appears", () => {
  const user = { id: "u1", role: "user" as const, text: "你好", createdAt: "t" };
  assert.equal(shouldShowThinking(true, [user]), true);
  assert.equal(shouldShowThinking(false, [user]), false);
  assert.equal(
    shouldShowThinking(true, [{ id: "a1", role: "assistant", text: "好", createdAt: "t", streaming: true }]),
    false,
  );
  assert.equal(
    shouldShowThinking(true, [
      user,
      { id: "a1", role: "assistant", text: "", createdAt: "t", tools: [{ name: "bash", status: "running" }] },
    ]),
    false,
  );
  assert.equal(
    shouldShowThinking(true, [{ id: "u1", role: "user", text: "你好", createdAt: "t" }, { id: "a1", role: "assistant", text: "好", createdAt: "t", streaming: false }]),
    false,
  );
  assert.equal(thinkingHint({ status: "PROVISIONING", remoteControl: true }), "正在启动本机 Worker…");
  assert.equal(thinkingHint({ status: "RUNNING" }), "正在思考…");
});

test("desk starting line is a whisper until the assistant starts", () => {
  const whisper = { id: "q", role: "setup" as const, text: DESK_STARTING_NOTICE, createdAt: "t", kind: "run.queued" };
  assert.equal(isStartupWhisper(whisper), true);
  assert.equal(generationStarted([whisper]), false);
  assert.equal(
    generationStarted([{ id: "a", role: "assistant", text: "", createdAt: "t", tools: [{ name: "bash" }] }]),
    true,
  );
});

test("sendFailureMessage keeps the error on the transcript", () => {
  const message = sendFailureMessage("quota", "2026-08-29T00:00:00.000Z");
  assert.equal(message.role, "setup");
  assert.equal(message.kind, "run.error");
  assert.equal(message.text, "quota");
});
