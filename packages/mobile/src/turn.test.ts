import assert from "node:assert/strict";
import test from "node:test";
import { pendingUserMessage, QUEUED_SLOT_NOTICE, sendFailureMessage, shouldRefreshTranscript, withQueuedNotice } from "./turn.js";

test("pendingUserMessage shows the typed text immediately", () => {
  const message = pendingUserMessage("你好", "2026-08-29T00:00:00.000Z");
  assert.equal(message.role, "user");
  assert.equal(message.text, "你好");
  assert.equal(message.id, "pending-2026-08-29T00:00:00.000Z");
});

test("shouldRefreshTranscript polls while queued or when SSE is quiet", () => {
  assert.equal(shouldRefreshTranscript({ lastSseAt: Date.now(), status: "NOT_YET_STARTED" }), true);
  assert.equal(shouldRefreshTranscript({ lastSseAt: Date.now(), status: "RUNNING" }), false);
  assert.equal(shouldRefreshTranscript({ lastSseAt: 0, now: 4000, status: "RUNNING" }), true);
});

test("withQueuedNotice inserts the slot-wait line once", () => {
  const first = withQueuedNotice([], "NOT_YET_STARTED", "2026-08-29T00:00:00.000Z");
  assert.equal(first.at(-1)?.text, QUEUED_SLOT_NOTICE);
  assert.equal(withQueuedNotice(first, "NOT_YET_STARTED").length, 1);
});

test("sendFailureMessage keeps the error on the transcript", () => {
  const message = sendFailureMessage("quota", "2026-08-29T00:00:00.000Z");
  assert.equal(message.role, "setup");
  assert.equal(message.kind, "run.error");
  assert.equal(message.text, "quota");
});
