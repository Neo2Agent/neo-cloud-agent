import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts/events";
import {
  applyRunEventsToMessages,
  buildTranscriptSnapshot,
  transcriptGroups,
} from "@neo-cloud-agent/contracts/transcript";
import {
  batchTurnSignal,
  isActiveRunStatus,
  isTerminalTurnEvent,
  liveActivityLabel,
  messageIsLive,
  parseSse,
  runEventsQuery,
  shouldShowAssistantActions,
  shouldShowThinking,
  statusFromEventKind,
  appendPendingUser,
  dropResolvedPendingUsers,
  mergeUnresolvedPending,
  pendingUserArrived,
  withPendingUser,
} from "./stream.js";

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

const HISTORY: RunEvent[] = [
  ev({ id: "u1", kind: "user.message", data: { text: "pwd" } }),
  ev({ id: "a1", kind: "agent.start" }),
  ev({
    id: "t1",
    kind: "tool.start",
    data: { toolCallId: "bash-1", toolName: "bash", args: { command: "pwd" } },
  }),
  ev({
    id: "t2",
    kind: "tool.update",
    data: { toolCallId: "bash-1", toolName: "bash", output: "/workspace" },
  }),
  ev({
    id: "t3",
    kind: "tool.end",
    data: { toolCallId: "bash-1", toolName: "bash", output: "/workspace", isError: false },
  }),
  ev({ id: "m1", kind: "message.delta", data: { delta: "当前目录是 /workspace" } }),
  ev({ id: "z1", kind: "run.idle" }),
];

test("runEventsQuery resumes after the snapshot cursor", () => {
  assert.equal(runEventsQuery(), "");
  assert.equal(runEventsQuery({ after: "t3" }), "?after=t3");
  assert.equal(
    runEventsQuery({ after: "t3", accessToken: "tok", client: "desk" }),
    "?after=t3&access_token=tok&client=desk",
  );
});

test("parseSse and terminal kinds match the web stream contract", () => {
  assert.equal(parseSse("{"), null);
  assert.equal(parseSse(JSON.stringify({ kind: "run.idle" })), null);
  assert.equal(parseSse(JSON.stringify(HISTORY[0]))?.id, "u1");
  assert.equal(isTerminalTurnEvent("run.idle"), true);
  assert.equal(isTerminalTurnEvent("agent.end"), false);
  assert.equal(isTerminalTurnEvent("user.message"), false);
  assert.equal(isActiveRunStatus("RUNNING"), true);
  assert.equal(isActiveRunStatus("IDLE"), false);
});

test("the open run leaves RUNNING when the turn ends", () => {
  assert.equal(statusFromEventKind("user.message", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("agent.start", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("run.idle", "RUNNING"), "IDLE");
  assert.equal(statusFromEventKind("agent.end", "RUNNING"), null);
  assert.equal(statusFromEventKind("run.error", "RUNNING"), "ERROR");
  assert.equal(statusFromEventKind("tool.start", "RUNNING"), null);
  // A follow-up queued against a finished run still means work is coming.
  assert.equal(statusFromEventKind("followup.queued", "IDLE"), "RUNNING");
  assert.equal(statusFromEventKind("followup.queued", "RUNNING"), "RUNNING");
});

test("batchTurnSignal treats a trailing run.idle as idle even after tools", () => {
  assert.equal(batchTurnSignal([{ kind: "tool.end" }, { kind: "run.idle" }]), "idle");
  assert.equal(batchTurnSignal([{ kind: "message.delta" }, { kind: "run.idle" }]), "idle");
  assert.equal(batchTurnSignal([{ kind: "run.idle" }, { kind: "tool.start" }]), "work");
  assert.equal(batchTurnSignal([{ kind: "run.error" }]), "fail");
});

test("replaying the snapshot event log duplicates user bubbles", () => {
  const snapshot = buildTranscriptSnapshot("run-1", HISTORY);
  const once = snapshot.messages;
  const replayed = applyRunEventsToMessages(once, HISTORY);
  assert.equal(once.filter((item) => item.role === "user").length, 1);
  assert.equal(replayed.filter((item) => item.role === "user").length, 2);
});

test("resuming after lastEventId keeps one user bubble and the bash tool", () => {
  const snapshot = buildTranscriptSnapshot("run-1", HISTORY);
  const live = HISTORY.filter((event) => event.id === "late");
  const next = applyRunEventsToMessages(snapshot.messages, live);
  assert.equal(snapshot.lastEventId, "z1");
  assert.equal(next.filter((item) => item.role === "user").length, 1);
  const assistant = next.find((item) => item.role === "assistant");
  const groups = assistant ? transcriptGroups(assistant) : [];
  const tools = groups.flatMap((group) => (group.type === "tools" ? group.tools : []));
  assert.equal(tools.some((tool) => tool.name === "bash"), true);
  assert.deepEqual(
    tools.find((tool) => tool.name === "bash")?.args,
    { command: "pwd" },
  );
});

test("tool.start during a live turn shows a running bash card before idle", () => {
  const live = applyRunEventsToMessages([], [
    ev({ id: "u1", kind: "user.message", data: { text: "pwd" } }),
    ev({ id: "a1", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.delta", data: { delta: "我来看一下" } }),
    ev({ id: "e1", kind: "message.end" }),
    ev({
      id: "t1",
      kind: "tool.start",
      data: { toolCallId: "bash-1", toolName: "bash", args: { command: "pwd" } },
    }),
  ]);
  const assistant = live.filter((item) => item.role === "assistant");
  assert.equal(liveActivityLabel(live), "正在执行 bash…");
  assert.equal(assistant.some(messageIsLive), true);
  const tools = assistant.flatMap((item) => transcriptGroups(item)).flatMap((group) => (group.type === "tools" ? group.tools : []));
  assert.equal(tools[0]?.name, "bash");
  assert.equal(tools[0]?.status, "running");
  for (const [index, message] of live.entries()) {
    if (message.role === "assistant") {
      assert.equal(shouldShowAssistantActions(live, index), false);
    }
  }
});

test("assistant actions stay hidden until the whole turn is idle", () => {
  const message = {
    id: "a1",
    role: "assistant" as const,
    text: "我来看一下",
    createdAt: "2026-08-21T00:00:01.000Z",
    streaming: false,
    blocks: [
      { type: "text" as const, text: "我来看一下" },
      { type: "tool" as const, tool: { id: "b1", name: "bash", status: "running" as const, args: { command: "pwd" } } },
    ],
    tools: [{ id: "b1", name: "bash", status: "running" as const, args: { command: "pwd" } }],
  };
  const live = [
    { id: "u1", role: "user" as const, text: "pwd", createdAt: "2026-08-21T00:00:00.000Z" },
    message,
  ];
  const groups = transcriptGroups(message);
  assert.equal(groups[0]?.type, "text");
  assert.equal(groups[1]?.type, "tools");
  assert.equal(shouldShowAssistantActions(live, 1), false);
});

test("assistant actions appear once at the bottom after the turn is idle", () => {
  const done = applyRunEventsToMessages([], [
    ev({ id: "u1", kind: "user.message", data: { text: "pwd" } }),
    ev({ id: "a1", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.delta", data: { delta: "我来看一下" } }),
    ev({ id: "e1", kind: "message.end" }),
    ev({
      id: "t1",
      kind: "tool.start",
      data: { toolCallId: "bash-1", toolName: "bash", args: { command: "pwd" } },
    }),
    ev({
      id: "t2",
      kind: "tool.end",
      data: { toolCallId: "bash-1", toolName: "bash", output: "/tmp", isError: false },
    }),
    ev({ id: "m2", kind: "message.delta", data: { delta: "当前目录是 /tmp" } }),
    ev({ id: "e2", kind: "message.end" }),
    ev({ id: "z1", kind: "run.idle" }),
  ]);
  const first = done.findIndex((item) => item.role === "assistant");
  let last = -1;
  for (let index = done.length - 1; index >= 0; index -= 1) {
    if (done[index]?.role === "assistant") {
      last = index;
      break;
    }
  }
  assert.equal(shouldShowAssistantActions(done, last), true);
  assert.equal(shouldShowAssistantActions(done, last, false), false);
  if (first !== last) {
    assert.equal(shouldShowAssistantActions(done, first), false);
  }
});

test("withPendingUser shows the follow-up as a chat bubble until the event arrives", () => {
  const pending = { id: "pending-1", text: "继续", createdAt: "2026-08-28T00:00:10.000Z" };
  const before = withPendingUser([], pending);
  assert.equal(before.length, 1);
  assert.equal(before[0]?.role, "user");
  assert.equal(before[0]?.text, "继续");
  const earlier = { id: "u0", role: "user" as const, text: "继续", createdAt: "2026-08-28T00:00:00.000Z" };
  assert.equal(pendingUserArrived([earlier], pending), false);
  const withHistory = appendPendingUser([earlier], pending);
  assert.deepEqual(withHistory.map((item) => item.id), ["u0", "pending-1"]);
  const arrived = withPendingUser(
    [earlier, { id: "u1", role: "user", text: "继续", createdAt: "2026-08-28T00:00:10.100Z" }],
    pending,
  );
  assert.equal(arrived.at(-1)?.id, "u1");
  assert.equal(arrived.some((item) => item.id === "pending-1"), false);
  const snapshot = [earlier];
  const afterReload = mergeUnresolvedPending(snapshot, withHistory);
  assert.deepEqual(afterReload.map((item) => item.id), ["u0", "pending-1"]);
  const resolved = dropResolvedPendingUsers([
    ...withHistory,
    { id: "u2", role: "user", text: "继续", createdAt: "2026-08-28T00:00:10.200Z" },
  ]);
  assert.deepEqual(resolved.map((item) => item.id), ["u0", "u2"]);
});

test("shouldShowThinking stays up until text streams or a tool is running", () => {
  const user = { id: "u1", role: "user" as const, text: "你好", createdAt: "2026-08-28T00:00:00.000Z" };
  const empty = { id: "a1", role: "assistant" as const, text: "", createdAt: user.createdAt, streaming: true };
  const toolsDone = {
    ...empty,
    streaming: false,
    tools: [{ id: "w1", name: "ls", status: "done" as const }],
  };
  assert.equal(shouldShowThinking(true, [user]), true);
  assert.equal(shouldShowThinking(false, [user]), false);
  assert.equal(shouldShowThinking(true, [user, empty]), true);
  assert.equal(shouldShowThinking(true, [user, toolsDone]), true);
  assert.equal(
    shouldShowThinking(true, [user, { ...empty, text: "好的", streaming: true }]),
    false,
  );
  assert.equal(
    shouldShowThinking(true, [
      user,
      { ...empty, tools: [{ id: "w1", name: "write", status: "running" }] },
    ]),
    false,
  );
});
