import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts";
import { transcriptGroups } from "@neo-cloud-agent/contracts";
import { buildTranscriptSnapshot } from "./transcript.js";

/** One reply bubble, read as the rows a user sees: text, then tools, then text. */
function rows(message: TranscriptMessage | undefined): string[] {
  if (!message) {
    return [];
  }
  return transcriptGroups(message).map((group) =>
    group.type === "tools" ? `tools:${group.tools.map((tool) => tool.name).join(",")}` : `text:${group.text}`,
  );
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

test("snapshot collapses token deltas for late subscribers", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "hello" } }),
    ev({ id: "s1", kind: "scm.clone_succeeded", title: "Workspace ready", category: "agent_setup" }),
    ev({ id: "a1", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "d1", kind: "message.delta", data: { delta: "Hel" }, seq: 5 }),
    ev({ id: "d2", kind: "message.delta", data: { delta: "lo" }, seq: 6 }),
    ev({ id: "t1", kind: "tool.end", data: { toolName: "bash", isError: false } }),
    ev({ id: "e1", kind: "message.end", seq: 8 }),
  ]);
  assert.equal(snapshot.runId, "run-1");
  assert.equal(snapshot.lastEventId, "e1");
  assert.equal(snapshot.seq, 8);
  const user = snapshot.messages.find((item) => item.role === "user");
  const assistant = snapshot.messages.find((item) => item.role === "assistant");
  const setup = snapshot.messages.find((item) => item.role === "setup");
  assert.equal(user?.text, "hello");
  assert.equal(assistant?.text, "Hello");
  assert.equal(assistant?.streaming, false);
  assert.equal(assistant?.tools?.[0]?.name, "bash");
  assert.equal(assistant?.tools?.[0]?.isError, false);
  assert.equal(assistant?.tools?.[0]?.status, "done");
  assert.equal(setup?.text, "Workspace ready");
});

test("tools after message.end stay between the intro and the reply", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "ls" } }),
    ev({ id: "a1", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "d1", kind: "message.delta", data: { delta: "Let me look." } }),
    ev({ id: "e1", kind: "message.end" }),
    ev({
      id: "t0",
      kind: "tool.start",
      data: { toolCallId: "call-1", toolName: "bash", args: { command: "ls -la" } },
    }),
    ev({
      id: "t1",
      kind: "tool.end",
      data: { toolCallId: "call-1", toolName: "bash", output: "README.md\n", isError: false },
    }),
    ev({ id: "m2", kind: "message.start" }),
    ev({ id: "d2", kind: "message.delta", data: { delta: "There is a README." } }),
    ev({ id: "e2", kind: "message.end" }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  const assistants = snapshot.messages.filter((item) => item.role === "assistant");
  // One reply, with the tool card sitting between the two pieces of text.
  assert.equal(assistants.length, 1);
  assert.deepEqual(rows(assistants[0]), ["text:Let me look.", "tools:bash", "text:There is a README."]);
  assert.deepEqual(assistants[0]?.tools, [
    {
      id: "call-1",
      name: "bash",
      args: { command: "ls -la" },
      output: "README.md\n",
      status: "done",
      isError: false,
    },
  ]);
});

test("two bash calls without toolCallId stay as separate tools", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "ls twice" } }),
    ev({ id: "a1", kind: "agent.start" }),
    ev({ id: "s1", kind: "tool.start", data: { toolName: "bash", args: { command: "pwd" } } }),
    ev({ id: "e1", kind: "tool.end", data: { toolName: "bash", isError: false } }),
    ev({ id: "s2", kind: "tool.start", data: { toolName: "bash", args: { command: "ls" } } }),
    ev({ id: "e2", kind: "tool.end", data: { toolName: "bash", isError: false } }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  const tools = snapshot.messages.find((item) => item.role === "assistant")?.tools ?? [];
  assert.equal(tools.length, 2);
  assert.equal(tools[0]?.args && (tools[0].args as { command?: string }).command, "pwd");
  assert.equal(tools[1]?.args && (tools[1].args as { command?: string }).command, "ls");
});

test("artifact uploads become setup cards with a download href", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({
      id: "a1",
      kind: "artifact.uploaded",
      title: "已上传 notes.txt",
      data: { url: "/v1/runs/run-1/artifacts/notes.txt", contentType: "text/plain" },
    }),
  ]);
  assert.equal(snapshot.messages[0]?.kind, "artifact.uploaded");
  assert.equal(snapshot.messages[0]?.href, "/v1/runs/run-1/artifacts/notes.txt");
  assert.equal(snapshot.messages[0]?.mediaType, "text/plain");
});

test("tools that run before the final reply stay above that reply", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "research this" } }),
    ev({ id: "a1", kind: "agent.start" }),
    ev({
      id: "t0",
      kind: "tool.start",
      data: { toolCallId: "browse-1", toolName: "neo_browse", args: { url: "https://example.com" } },
    }),
    ev({
      id: "t1",
      kind: "tool.end",
      data: { toolCallId: "browse-1", toolName: "neo_browse", output: "Example Domain", isError: false },
    }),
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "d1", kind: "message.delta", data: { delta: "According to the page, this is example.com." } }),
    ev({ id: "e1", kind: "message.end" }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  const assistants = snapshot.messages.filter((item) => item.role === "assistant");
  assert.equal(assistants.length, 1);
  assert.deepEqual(rows(assistants[0]), ["tools:neo_browse", "text:According to the page, this is example.com."]);
});

test("late tool posts still sit between the intro and the reply", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "u1", kind: "user.message", data: { text: "research this" } }),
    ev({ id: "a1", kind: "agent.start", data: { workerSeq: 1 }, createdAt: "2026-08-21T00:00:01.000Z" }),
    ev({ id: "m1", kind: "message.start", data: { workerSeq: 2 }, createdAt: "2026-08-21T00:00:02.000Z" }),
    ev({
      id: "d1",
      kind: "message.delta",
      data: { delta: "Let me check.", workerSeq: 3 },
      createdAt: "2026-08-21T00:00:03.000Z",
    }),
    ev({ id: "e1", kind: "message.end", data: { workerSeq: 4 }, createdAt: "2026-08-21T00:00:04.000Z" }),
    ev({ id: "m2", kind: "message.start", data: { workerSeq: 8 }, createdAt: "2026-08-21T00:00:08.000Z" }),
    ev({
      id: "d2",
      kind: "message.delta",
      data: { delta: "According to the page, this is example.com.", workerSeq: 9 },
      createdAt: "2026-08-21T00:00:09.000Z",
    }),
    ev({ id: "e2", kind: "message.end", data: { workerSeq: 10 }, createdAt: "2026-08-21T00:00:10.000Z" }),
    ev({
      id: "t0",
      kind: "tool.start",
      data: { workerSeq: 5, toolCallId: "browse-1", toolName: "neo_browse" },
      createdAt: "2026-08-21T00:00:05.000Z",
    }),
    ev({
      id: "t1",
      kind: "tool.end",
      data: { workerSeq: 6, toolCallId: "browse-1", toolName: "neo_browse", output: "Example Domain" },
      createdAt: "2026-08-21T00:00:06.000Z",
    }),
    ev({ id: "z1", kind: "agent.end", data: { workerSeq: 11 }, createdAt: "2026-08-21T00:00:11.000Z" }),
  ]);
  const assistants = snapshot.messages.filter((item) => item.role === "assistant");
  assert.equal(assistants.length, 1);
  assert.deepEqual(rows(assistants[0]), [
    "text:Let me check.",
    "tools:neo_browse",
    "text:According to the page, this is example.com.",
  ]);
});

test("empty assistant turns without tools are dropped", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "a1", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "e1", kind: "message.end" }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  assert.equal(snapshot.messages.length, 0);
});

test("run.error closes a cut-off stream so the composer is not stuck", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "d1", kind: "message.delta", data: { delta: "half" } }),
    ev({ id: "t1", kind: "tool.start", data: { toolName: "bash" } }),
    ev({ id: "e1", kind: "run.error", title: "worker heartbeat lost after control plane restart" }),
  ]);
  const assistant = snapshot.messages.find((item) => item.role === "assistant");
  const notice = snapshot.messages.find((item) => item.role === "setup");
  assert.equal(assistant?.streaming, false);
  assert.equal(assistant?.tools?.[0]?.status, "done");
  assert.equal(assistant?.text, "half");
  assert.match(notice?.text ?? "", /heartbeat lost/);
});

test("in-progress assistant stays streaming so another client can tail", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "d1", kind: "message.delta", data: { delta: "partial" }, seq: 2 }),
  ]);
  assert.equal(snapshot.messages[0]?.streaming, true);
  assert.equal(snapshot.messages[0]?.text, "partial");
  assert.equal(snapshot.lastEventId, "d1");
});
