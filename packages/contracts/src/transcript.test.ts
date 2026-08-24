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
  const busy = displayTranscriptMessages(
    [
      {
        id: "q1",
        role: "setup",
        text: "All VM slots are busy",
        createdAt: "2026-08-21T00:00:00.000Z",
        kind: "run.queued",
      },
    ],
    { hideStaleRestart: true },
  );
  assert.equal(busy.length, 0);
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

test("nested subagent tool events stay inside the parent card", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "调研" } }),
    ev({ id: "a1", kind: "agent.start" }),
    ev({
      id: "p0",
      kind: "tool.start",
      data: {
        toolCallId: "parent-1",
        toolName: "neo_subagent",
        args: {
          tasks: [
            { agent: "scout", task: "market" },
            { agent: "scout", task: "vendors" },
          ],
        },
      },
    }),
    ev({
      id: "c0",
      kind: "tool.start",
      data: {
        toolCallId: "child-1",
        toolName: "bash",
        subagent: "scout",
        subagentId: "sa-1",
        args: { command: "curl https://example.com" },
      },
    }),
    ev({
      id: "c1",
      kind: "tool.end",
      data: {
        toolCallId: "child-1",
        toolName: "bash",
        subagent: "scout",
        subagentId: "sa-1",
        output: "timeout",
        isError: true,
      },
    }),
    ev({
      id: "c2",
      kind: "tool.start",
      data: {
        toolCallId: "child-2",
        toolName: "neo_browse",
        subagent: "scout",
        subagentId: "sa-2",
        args: { url: "https://example.com" },
      },
    }),
    ev({
      id: "p1",
      kind: "tool.end",
      data: {
        toolCallId: "parent-1",
        toolName: "neo_subagent",
        output: "## 1. scout\nok",
        details: { mode: "parallel", agents: ["scout", "scout"] },
        isError: false,
      },
    }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  const assistant = snapshot.messages.find((item) => item.role === "assistant");
  assert.equal(assistant?.tools?.length, 1);
  assert.equal(assistant?.tools?.[0]?.name, "neo_subagent");
  assert.equal(assistant?.tools?.[0]?.status, "done");
  assert.equal(assistant?.tools?.[0]?.details?.mode, "parallel");
  const steps = assistant?.tools?.[0]?.details?.steps as Array<{ name: string; isError?: boolean }> | undefined;
  assert.equal(steps?.length, 2);
  assert.equal(steps?.[0]?.name, "bash");
  assert.equal(steps?.[0]?.isError, true);
  assert.equal(steps?.[1]?.name, "neo_browse");
  assert.equal(assistant?.tools?.some((tool) => tool.name === "bash"), false);
});

test("live nested events attach to an already compiled parent card", () => {
  const seed: TranscriptMessage[] = [
    {
      id: "a1",
      role: "assistant",
      text: "",
      createdAt: "2026-08-21T00:00:01.000Z",
      streaming: true,
      tools: [
        {
          id: "parent-1",
          name: "neo_subagent",
          status: "running",
          args: { agent: "scout", task: "find auth" },
          details: { mode: "single", agents: ["scout"], tasks: [{ agent: "scout", task: "find auth" }] },
        },
      ],
    },
  ];
  const next = applyRunEventsToMessages(seed, [
    ev({
      id: "c0",
      kind: "tool.start",
      data: { toolCallId: "grep-1", toolName: "grep", subagent: "scout", args: { pattern: "auth" } },
    }),
    ev({
      id: "c1",
      kind: "tool.end",
      data: { toolCallId: "grep-1", toolName: "grep", subagent: "scout", output: "src/auth.ts", isError: false },
    }),
  ]);
  assert.equal(next[0]?.tools?.length, 1);
  assert.equal(next[0]?.tools?.[0]?.name, "neo_subagent");
  assert.equal(next[0]?.tools?.[0]?.status, "running");
  const steps = next[0]?.tools?.[0]?.details?.steps as Array<{ name: string; status?: string }> | undefined;
  assert.equal(steps?.[0]?.name, "grep");
  assert.equal(steps?.[0]?.status, "done");
});

test("message.end does not settle a still-running subagent card", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "d1", kind: "message.delta", data: { delta: "先委派。" } }),
    ev({
      id: "p0",
      kind: "tool.start",
      data: { toolCallId: "parent-1", toolName: "neo_subagent", args: { agent: "scout", task: "look" } },
    }),
    ev({ id: "e1", kind: "message.end" }),
  ]);
  const assistant = snapshot.messages.find((item) => item.role === "assistant");
  assert.equal(assistant?.tools?.[0]?.status, "running");
  assert.equal(assistant?.streaming, false);
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

test("transcript messages keep createdAt and bump updatedAt on later events", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", createdAt: "2026-08-21T00:00:00.000Z", data: { text: "hi" } }),
    ev({ id: "s1", kind: "message.start", createdAt: "2026-08-21T00:00:01.000Z" }),
    ev({ id: "d1", kind: "message.delta", createdAt: "2026-08-21T00:00:02.000Z", data: { delta: "hello" } }),
    ev({ id: "e1", kind: "message.end", createdAt: "2026-08-21T00:00:05.000Z" }),
  ]);
  const user = snapshot.messages.find((item) => item.role === "user");
  const assistant = snapshot.messages.find((item) => item.role === "assistant");
  assert.equal(user?.createdAt, "2026-08-21T00:00:00.000Z");
  assert.equal(user?.updatedAt, "2026-08-21T00:00:00.000Z");
  assert.equal(assistant?.createdAt, "2026-08-21T00:00:01.000Z");
  assert.equal(assistant?.updatedAt, "2026-08-21T00:00:05.000Z");
  assert.equal(assistant?.streaming, false);
});

test("later agent.end does not rewrite an already finished assistant updatedAt", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", createdAt: "2026-08-21T00:00:00.000Z", data: { text: "one" } }),
    ev({ id: "s1", kind: "message.start", createdAt: "2026-08-21T00:00:01.000Z" }),
    ev({ id: "d1", kind: "message.delta", createdAt: "2026-08-21T00:00:02.000Z", data: { delta: "first" } }),
    ev({ id: "e1", kind: "message.end", createdAt: "2026-08-21T00:00:03.000Z" }),
    ev({ id: "z1", kind: "agent.end", createdAt: "2026-08-21T00:00:04.000Z" }),
    ev({ id: "u2", kind: "user.message", createdAt: "2026-08-21T01:00:00.000Z", data: { text: "two" } }),
    ev({ id: "s2", kind: "message.start", createdAt: "2026-08-21T01:00:01.000Z" }),
    ev({ id: "d2", kind: "message.delta", createdAt: "2026-08-21T01:00:02.000Z", data: { delta: "second" } }),
    ev({ id: "e2", kind: "message.end", createdAt: "2026-08-21T01:00:03.000Z" }),
    ev({ id: "z2", kind: "agent.end", createdAt: "2026-08-21T01:00:04.000Z" }),
  ]);
  const assistants = snapshot.messages.filter((item) => item.role === "assistant");
  assert.equal(assistants[0]?.text, "first");
  assert.equal(assistants[0]?.updatedAt, "2026-08-21T00:00:03.000Z");
  assert.equal(assistants[1]?.text, "second");
  assert.equal(assistants[1]?.updatedAt, "2026-08-21T01:00:03.000Z");
});
