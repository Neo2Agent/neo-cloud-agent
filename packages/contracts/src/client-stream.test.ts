import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveEvents, batchTurnSignal, parseSseData, runEventsQuery, runsNewestFirst } from "./client-stream.js";
import type { RunEvent } from "./events.js";

function ev(id: string, kind: RunEvent["kind"], delta?: string): RunEvent {
  return {
    id,
    runId: "run-1",
    createdAt: "2026-08-22T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind,
    title: id,
    ...(delta !== undefined ? { data: { delta } } : {}),
  };
}

test("applyLiveEvents folds consecutive token deltas into one row", () => {
  const next = applyLiveEvents([ev("s", "message.start")], [ev("d1", "message.delta", "Hel"), ev("d2", "message.delta", "lo")]);
  assert.equal(next.length, 2);
  assert.equal(next[1]?.id, "d2");
  assert.equal(next[1]?.data?.delta, "Hello");
});

test("applyLiveEvents ignores duplicates and bad payloads", () => {
  const first = ev("d1", "message.delta", "Hi");
  const next = applyLiveEvents([first], [first, ev("d2", "message.delta", "!")]);
  assert.equal(next.length, 1);
  assert.equal(next[0]?.data?.delta, "Hi!");
  assert.equal(parseSseData("not-json"), null);
  assert.equal(parseSseData(JSON.stringify({ kind: "ping" })), null);
  assert.equal(parseSseData(JSON.stringify(first))?.id, "d1");
});

test("batchTurnSignal reports the last turn signal in a batch", () => {
  assert.equal(batchTurnSignal([]), null);
  assert.equal(batchTurnSignal([{ kind: "llm.usage" }]), null);
  assert.equal(batchTurnSignal([{ kind: "agent.start" }, { kind: "tool.start" }]), "work");
  assert.equal(batchTurnSignal([{ kind: "tool.end" }, { kind: "run.idle" }]), "idle");
  assert.equal(batchTurnSignal([{ kind: "run.idle" }, { kind: "message.delta" }]), "work");
  assert.equal(batchTurnSignal([{ kind: "message.delta" }, { kind: "run.error" }]), "fail");
});

test("runEventsQuery only carries the parameters it was given", () => {
  assert.equal(runEventsQuery(), "");
  assert.equal(runEventsQuery({ after: "e1" }), "?after=e1");
  assert.equal(runEventsQuery({ after: "e1", accessToken: "t", client: "desk" }), "?after=e1&access_token=t&client=desk");
});

test("runsNewestFirst orders by last activity", () => {
  const runs = [
    { id: "old", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" },
    { id: "touched", createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z" },
    { id: "new", createdAt: "2026-09-10T00:00:00Z" },
  ];
  assert.deepEqual(runsNewestFirst(runs).map((run) => run.id), ["touched", "new", "old"]);
  assert.equal(runs[0]?.id, "old", "input is not mutated");
});
