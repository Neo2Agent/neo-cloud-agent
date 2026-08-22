import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, TranscriptMessage } from "./events.js";
import {
  applyRunEventsToMessages,
  buildTranscriptSnapshot,
  displayTranscriptMessages,
  pageTranscriptMessages,
  pageTranscriptSnapshot,
  transcriptHasUnsettledWork,
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

test("apply tool.end onto a compiled page closes the original running tool card", () => {
  const seed: TranscriptMessage[] = [
    { id: "u1", role: "user", text: "ls", createdAt: "2026-08-21T00:00:00.000Z" },
    {
      id: "a1",
      role: "assistant",
      text: "",
      createdAt: "2026-08-21T00:00:01.000Z",
      streaming: false,
      tools: [{ id: "call-1", name: "ls", status: "running" }],
      blocks: [{ type: "tool", tool: { id: "call-1", name: "ls", status: "running" } }],
    },
    {
      id: "a2",
      role: "assistant",
      text: "workspace is empty",
      createdAt: "2026-08-21T00:00:02.000Z",
      streaming: false,
      tools: [],
      blocks: [{ type: "text", text: "workspace is empty" }],
    },
  ];
  const next = applyRunEventsToMessages(seed, [
    ev({
      id: "t-end",
      kind: "tool.end",
      data: { toolCallId: "call-1", toolName: "ls", output: "README.md\n", isError: false },
    }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  const tools = next.find((item) => item.id === "a1")?.tools ?? [];
  const groups = next.find((item) => item.id === "a1");
  assert.equal(tools[0]?.status, "done");
  assert.equal(groups?.blocks?.find((block) => block.type === "tool")?.tool.status, "done");
  assert.equal(next.some((item) => item.tools?.some((tool) => tool.status === "running")), false);
});

test("agent.end settles running tools left on earlier assistants", () => {
  const seed: TranscriptMessage[] = [
    {
      id: "a1",
      role: "assistant",
      text: "",
      createdAt: "2026-08-21T00:00:01.000Z",
      streaming: false,
      tools: [{ id: "ls-1", name: "ls", status: "running" }],
    },
    {
      id: "a2",
      role: "assistant",
      text: "done",
      createdAt: "2026-08-21T00:00:02.000Z",
      streaming: false,
    },
  ];
  const next = applyRunEventsToMessages(seed, [ev({ id: "z1", kind: "agent.end" })]);
  assert.equal(next[0]?.tools?.[0]?.status, "done");
  assert.equal(next[1]?.streaming, false);
});

test("stale control-plane restart notices hide after the conversation continues", () => {
  const heartbeat: TranscriptMessage = {
    id: "err",
    role: "setup",
    text: "worker heartbeat lost after control plane restart",
    createdAt: "2026-08-21T00:00:00.000Z",
    kind: "run.error",
    level: "error",
  };
  const continued = displayTranscriptMessages([
    heartbeat,
    { id: "u1", role: "user", text: "你好", createdAt: "2026-08-21T00:00:01.000Z" },
    { id: "a1", role: "assistant", text: "你好！", createdAt: "2026-08-21T00:00:02.000Z" },
  ]);
  assert.equal(continued.some((item) => /heartbeat lost/.test(item.text)), false);
  const recovered = displayTranscriptMessages([heartbeat], { hideStaleRestart: true });
  assert.equal(recovered.length, 0);
  assert.equal(displayTranscriptMessages([heartbeat]).length, 1);
});

test("transcriptHasUnsettledWork sees running tools on either tools or blocks", () => {
  assert.equal(
    transcriptHasUnsettledWork([
      {
        id: "a1",
        role: "assistant",
        text: "",
        createdAt: "2026-08-21T00:00:01.000Z",
        blocks: [{ type: "tool", tool: { id: "c1", name: "ls", status: "running" } }],
      },
    ]),
    true,
  );
  assert.equal(
    transcriptHasUnsettledWork([
      {
        id: "a1",
        role: "assistant",
        text: "done",
        createdAt: "2026-08-21T00:00:01.000Z",
        streaming: false,
        tools: [{ id: "c1", name: "ls", status: "done" }],
      },
    ]),
    false,
  );
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
