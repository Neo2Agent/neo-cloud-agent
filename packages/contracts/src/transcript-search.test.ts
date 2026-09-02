import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptMessage } from "./events.js";
import { searchTranscript, userQuestions } from "./transcript-search.js";

function msg(id: string, role: TranscriptMessage["role"], text: string): TranscriptMessage {
  return { id, role, text, createdAt: "2026-08-28T00:00:00.000Z" };
}

test("searchTranscript matches text and skips empty queries", () => {
  const messages = [msg("1", "user", "改鉴权"), msg("2", "assistant", "准备改 rate-limit")];
  assert.equal(searchTranscript(messages, "").length, 0);
  assert.deepEqual(
    searchTranscript(messages, "鉴权").map((item) => item.id),
    ["1"],
  );
});

test("userQuestions keeps only user turns", () => {
  const messages = [msg("1", "user", "一"), msg("2", "assistant", "二"), msg("3", "setup", "三")];
  assert.deepEqual(
    userQuestions(messages).map((item) => item.id),
    ["1"],
  );
});
