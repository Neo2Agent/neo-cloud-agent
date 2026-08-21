import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";
import { buildTranscriptSnapshot } from "./transcript.js";

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

test("tools after message.end stay on the same assistant and keep args/output", () => {
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
    ev({ id: "d2", kind: "message.delta", data: { delta: " There is a README." } }),
    ev({ id: "e2", kind: "message.end" }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  const assistants = snapshot.messages.filter((item) => item.role === "assistant");
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0]?.text, "Let me look. There is a README.");
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

test("empty assistant turns without tools are dropped", () => {
  const snapshot = buildTranscriptSnapshot("run-1", [
    ev({ id: "a1", kind: "agent.start" }),
    ev({ id: "m1", kind: "message.start" }),
    ev({ id: "e1", kind: "message.end" }),
    ev({ id: "z1", kind: "agent.end" }),
  ]);
  assert.equal(snapshot.messages.length, 0);
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
