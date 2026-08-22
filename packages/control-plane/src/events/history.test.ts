import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";
import { compactClosedDeltaRuns, compactHotEvents, keepHotHistory } from "./history.js";

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

test("archived and expired runs do not keep a hot event log", () => {
  assert.equal(keepHotHistory("RUNNING"), true);
  assert.equal(keepHotHistory("IDLE"), true);
  assert.equal(keepHotHistory("ERROR"), true);
  assert.equal(keepHotHistory("ARCHIVED"), false);
  assert.equal(keepHotHistory("EXPIRED"), false);
});

test("compactHotEvents merges consecutive token deltas and keeps other events", () => {
  const compacted = compactHotEvents([
    ev("s", "message.start"),
    ev("d1", "message.delta", "Hel"),
    ev("d2", "message.delta", "lo"),
    ev("t", "tool.start"),
    ev("d3", "message.delta", "!"),
    ev("e", "message.end"),
  ]);
  assert.deepEqual(
    compacted.map((item) => [item.id, item.kind, item.data?.delta]),
    [
      ["s", "message.start", undefined],
      ["d2", "message.delta", "Hello"],
      ["t", "tool.start", undefined],
      ["d3", "message.delta", "!"],
      ["e", "message.end", undefined],
    ],
  );
});

test("compactClosedDeltaRuns waits for a non-delta before folding tokens", () => {
  const open = [ev("d1", "message.delta", "Hel"), ev("d2", "message.delta", "lo")];
  compactClosedDeltaRuns(open);
  assert.equal(open.length, 2);
  const closed = [...open, ev("e", "message.end")];
  compactClosedDeltaRuns(closed);
  assert.equal(closed.length, 2);
  assert.equal(closed[0]?.id, "d2");
  assert.equal(closed[0]?.data?.delta, "Hello");
  assert.equal(closed[1]?.kind, "message.end");
});
