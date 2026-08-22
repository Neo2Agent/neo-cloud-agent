import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts/events";
import { applyLiveEvents, parseSseData } from "./stream-apply.js";

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
  assert.equal(parseSseData(JSON.stringify(first))?.id, "d1");
});
