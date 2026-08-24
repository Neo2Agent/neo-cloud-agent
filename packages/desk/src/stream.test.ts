import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts/events";
import {
  applyRunEventsToMessages,
  buildTranscriptSnapshot,
  transcriptGroups,
} from "@neo-cloud-agent/contracts/transcript";
import {
  isActiveRunStatus,
  isTerminalTurnEvent,
  liveActivityLabel,
  messageIsLive,
  parseSse,
  runEventsQuery,
  shouldShowAssistantActions,
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
    runEventsQuery({ after: "t3", accessToken: "tok" }),
    "?after=t3&access_token=tok",
  );
});

test("parseSse and terminal kinds match the web stream contract", () => {
  assert.equal(parseSse("{"), null);
  assert.equal(parseSse(JSON.stringify({ kind: "run.idle" })), null);
  assert.equal(parseSse(JSON.stringify(HISTORY[0]))?.id, "u1");
  assert.equal(isTerminalTurnEvent("run.idle"), true);
  assert.equal(isTerminalTurnEvent("agent.end"), true);
  assert.equal(isTerminalTurnEvent("user.message"), false);
  assert.equal(isActiveRunStatus("RUNNING"), true);
  assert.equal(isActiveRunStatus("IDLE"), false);
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
  const textMessage = assistant.find((item) => item.text.trim());
  const textGroups = textMessage ? transcriptGroups(textMessage) : [];
  const textIndex = textGroups.findIndex((group) => group.type === "text");
  assert.equal(textMessage ? shouldShowAssistantActions(textMessage, textGroups, textIndex) : false, true);
});

test("assistant actions stay on settled text while a later bash card is running", () => {
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
  const groups = transcriptGroups(message);
  assert.equal(groups[0]?.type, "text");
  assert.equal(groups[1]?.type, "tools");
  assert.equal(shouldShowAssistantActions(message, groups, 0), true);
  assert.equal(shouldShowAssistantActions(message, groups, 1), false);
  assert.equal(shouldShowAssistantActions({ ...message, streaming: true }, groups, 0), false);
});
