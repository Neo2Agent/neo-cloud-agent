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
  assert.deepEqual(assistant?.tools, [{ name: "bash", isError: false }]);
  assert.equal(setup?.text, "Workspace ready");
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
