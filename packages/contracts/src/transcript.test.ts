import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, TranscriptMessage } from "./events.js";
import {
  applyRunEventsToMessages,
  buildTranscriptSnapshot,
  pageTranscriptMessages,
  pageTranscriptSnapshot,
} from "./transcript.js";

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

test("pageTranscriptMessages returns the newest page and a before cursor", () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({
    id: `m${index + 1}`,
    role: "user" as const,
    text: `msg ${index + 1}`,
    createdAt: "2026-08-21T00:00:00.000Z",
  }));
  const page = pageTranscriptMessages(messages, { limit: 2 });
  assert.deepEqual(
    page.messages.map((item) => item.id),
    ["m4", "m5"],
  );
  assert.equal(page.remaining, 3);
  assert.equal(page.nextBefore, "m4");
  const older = pageTranscriptMessages(messages, { before: "m4", limit: 2 });
  assert.deepEqual(
    older.messages.map((item) => item.id),
    ["m2", "m3"],
  );
  assert.equal(older.remaining, 1);
  assert.equal(older.nextBefore, "m2");
});

test("pageTranscriptMessages returns an empty page for an unknown cursor", () => {
  const page = pageTranscriptMessages(
    [{ id: "m1", role: "user", text: "hi", createdAt: "2026-08-21T00:00:00.000Z" }],
    { before: "missing" },
  );
  assert.deepEqual(page, { messages: [], remaining: 0, nextBefore: null });
});

test("pageTranscriptSnapshot keeps lastEventId from the full log", () => {
  const full = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "one" } }),
    ev({ id: "u2", kind: "user.message", data: { text: "two" } }),
    ev({ id: "u3", kind: "user.message", data: { text: "three" } }),
  ]);
  const page = pageTranscriptSnapshot(full, { limit: 1 });
  assert.equal(page.lastEventId, "u3");
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0]?.text, "three");
  assert.equal(page.remaining, 2);
  assert.equal(page.total, 3);
});

test("applyRunEventsToMessages continues a streaming assistant without replaying history", () => {
  const seed: TranscriptMessage[] = [
    { id: "u1", role: "user", text: "hello", createdAt: "2026-08-21T00:00:00.000Z" },
    {
      id: "a1",
      role: "assistant",
      text: "Hel",
      createdAt: "2026-08-21T00:00:01.000Z",
      streaming: true,
      tools: [],
      blocks: [{ type: "text", text: "Hel" }],
    },
  ];
  const next = applyRunEventsToMessages(seed, [
    ev({ id: "d2", kind: "message.delta", data: { delta: "lo" } }),
    ev({ id: "e1", kind: "message.end" }),
  ]);
  assert.equal(seed[1]?.text, "Hel");
  assert.equal(next[1]?.text, "Hello");
  assert.equal(next[1]?.streaming, false);
});
