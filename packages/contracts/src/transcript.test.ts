import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, TranscriptMessage } from "./events.js";
import {
  applyRunEventsToMessages,
  buildTranscriptSnapshot,
  displayTranscriptMessages,
  isSetupKind,
  pageTranscriptMessages,
  pageTranscriptSnapshot,
  sortRunEvents,
  transcriptHasUnsettledWork,
  transcriptGroups,
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
  // The current turn stays open; run.idle is what marks the bubble complete.
  assert.equal(next[1]?.streaming, true);
});

test("write then read then text stay one Neo bubble when pi ends each LLM round", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "测试.txt,写一个hello world!" } }),
    ev({ id: "s1", kind: "agent.start" }),
    ev({ id: "t1", kind: "tool.start", data: { toolCallId: "w1", toolName: "write" } }),
    ev({ id: "t2", kind: "tool.end", data: { toolCallId: "w1", toolName: "write", output: "ok" } }),
    ev({ id: "z1", kind: "agent.end" }),
    ev({ id: "idle1", kind: "run.idle" }),
    ev({ id: "s2", kind: "agent.start" }),
    ev({ id: "t3", kind: "tool.start", data: { toolCallId: "r1", toolName: "read" } }),
    ev({ id: "t4", kind: "tool.end", data: { toolCallId: "r1", toolName: "read", output: "hello world!" } }),
    ev({ id: "z2", kind: "agent.end" }),
    ev({ id: "idle2", kind: "run.idle" }),
    ev({ id: "s3", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.delta", data: { delta: "完成 ✅" } }),
    ev({ id: "m2", kind: "message.end" }),
    ev({ id: "z3", kind: "agent.end" }),
    ev({ id: "idle3", kind: "run.idle" }),
  ]);
  assert.deepEqual(snapshot.messages.map((item) => item.role), ["user", "assistant"]);
  const reply = snapshot.messages[1];
  assert.equal(reply?.streaming, false);
  assert.deepEqual(
    transcriptGroups(reply as TranscriptMessage).map((group) =>
      group.type === "tools" ? group.tools.map((tool) => tool.name).join("+") : group.text,
    ),
    ["write+read", "完成 ✅"],
  );
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

test("llm.error shows as a setup notice; llm.usage does not", () => {
  assert.equal(isSetupKind("llm.error"), true);
  assert.equal(isSetupKind("llm.usage"), false);
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "继续啊" } }),
    ev({ id: "s1", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "e1", kind: "message.end" }),
    ev({ id: "z1", kind: "agent.end" }),
    ev({
      id: "err",
      kind: "llm.error",
      level: "error",
      title: "模型没有返回内容",
      detail: "上游拒绝了这次请求",
    }),
    ev({ id: "use", kind: "llm.usage", title: "Token usage", data: { promptTokens: 12 } }),
  ]);
  assert.deepEqual(
    snapshot.messages.map((item) => item.role),
    ["user", "setup"],
  );
  assert.match(snapshot.messages[1]?.text ?? "", /模型没有返回内容/);
  assert.equal(
    snapshot.messages.some((item) => /Token usage/.test(item.text)),
    false,
  );
});

test("one user turn is one reply bubble even when text and tools alternate", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "只回复 order2" } }),
    ev({ id: "s1", kind: "agent.start" }),
    ev({ id: "t1", kind: "tool.start", data: { toolCallId: "ls", toolName: "ls" } }),
    ev({ id: "t2", kind: "tool.end", data: { toolCallId: "ls", toolName: "ls", output: "README.md" } }),
    ev({ id: "m1", kind: "message.delta", data: { delta: "先看看目录。" } }),
    ev({ id: "m2", kind: "message.end" }),
    ev({ id: "t3", kind: "tool.start", data: { toolCallId: "read", toolName: "read" } }),
    ev({ id: "t4", kind: "tool.end", data: { toolCallId: "read", toolName: "read", output: "target" } }),
    ev({ id: "m3", kind: "message.delta", data: { delta: "order2" } }),
    ev({ id: "m4", kind: "message.end" }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  assert.deepEqual(snapshot.messages.map((item) => item.role), ["user", "assistant"]);
  const reply = snapshot.messages[1];
  assert.equal(reply?.text, "先看看目录。order2");
  // Tools stay in place between the two pieces of text.
  assert.deepEqual(
    transcriptGroups(reply as TranscriptMessage).map((group) =>
      group.type === "tools" ? group.tools.map((tool) => tool.name).join("+") : group.text,
    ),
    ["ls", "先看看目录。", "read", "order2"],
  );
});

test("a second worker process does not sort its turn in front of the first", () => {
  const at = (seconds: number) => `2026-08-27T10:0${seconds}:00.000Z`;
  const ev = (id: string, kind: string, seq: number, epoch: string, seconds: number, extra?: Record<string, unknown>) => ({
    id,
    runId: "run-1",
    createdAt: at(seconds),
    category: "agent_run" as const,
    level: "info" as const,
    kind: kind as RunEvent["kind"],
    title: kind,
    data: { workerSeq: seq, workerEpoch: epoch, ...extra },
  });
  // Turn one ran in process A; turn two in process B, whose seq restarts at 1.
  const sorted = sortRunEvents([
    ev("b1", "user.message", 1, "B", 5, { text: "second" }),
    ev("a1", "user.message", 1, "A", 1, { text: "first" }),
    ev("a2", "message.delta", 2, "A", 2, { delta: "one" }),
    ev("b2", "message.delta", 2, "B", 6, { delta: "two" }),
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["a1", "a2", "b1", "b2"]);
});

test("the desk claim handshake never shows on the machine, and disappears elsewhere once it starts", () => {
  const claim: TranscriptMessage = {
    id: "q1",
    role: "setup",
    text: "等待本机 Desk 认领",
    createdAt: "2026-08-27T00:00:00.000Z",
    kind: "run.queued",
  };
  // On the desk itself the local bar covers this, so it is always hidden.
  assert.equal(displayTranscriptMessages([claim], { hideDeskHandshake: true }).length, 0);
  const interrupted: TranscriptMessage = {
    id: "q1",
    role: "setup",
    text: "中断的回合已自动排队，空出来会继续",
    createdAt: "2026-08-27T00:00:00.000Z",
    kind: "followup.queued",
  };
  assert.equal(displayTranscriptMessages([interrupted], { hideDeskHandshake: true }).length, 0);
  // On the web it is real information while the machine has not picked it up.
  assert.equal(displayTranscriptMessages([claim]).length, 1);
  // Once the run actually started it is stale everywhere.
  const started = displayTranscriptMessages([
    claim,
    { id: "a1", role: "assistant", text: "local-ok", createdAt: "2026-08-27T00:00:05.000Z" },
  ]);
  assert.deepEqual(started.map((item) => item.role), ["assistant"]);
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

test("transcriptGroups keeps bash tools that only live on message.tools", () => {
  const groups = transcriptGroups({
    id: "a1",
    role: "assistant",
    text: "我来查一下",
    createdAt: "2026-08-21T00:00:01.000Z",
    streaming: true,
    blocks: [{ type: "text", text: "我来查一下" }],
    tools: [{ id: "b1", name: "bash", status: "running", args: { command: "ls" } }],
  });
  assert.equal(groups[0]?.type, "text");
  assert.equal(groups[1]?.type, "tools");
  assert.equal(groups[1]?.type === "tools" ? groups[1].tools[0]?.name : "", "bash");
});

test("user bubbles keep follow-up actor metadata and stay hidden while queued", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({
      id: "u1",
      kind: "user.message",
      data: { text: "B is waiting", followUpId: "fu-b", actorUserId: "user-b", actorEmail: "ping" },
    }),
  ]);
  const user = snapshot.messages.find((item) => item.role === "user");
  assert.equal(user?.followUpId, "fu-b");
  assert.equal(user?.actorUserId, "user-b");
  assert.equal(user?.actorEmail, "ping");
  assert.equal(displayTranscriptMessages(snapshot.messages, { hideFollowUpIds: ["fu-b"] }).length, 0);
  assert.equal(displayTranscriptMessages(snapshot.messages, { hideFollowUpIds: ["other"] }).length, 1);
});
