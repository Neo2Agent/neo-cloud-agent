import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";

process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-bus-hist-"));
process.env.OBJECT_STORE = "none";

const { dropHistory, eventsForRun, listEvents, publish, resetHistory } = await import("./bus.js");
const { loadPersistedEvents } = await import("../store/persist.js");

function ev(id: string, delta: string): RunEvent {
  return {
    id,
    runId: "run-hot-mem",
    createdAt: "2026-08-22T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind: "message.delta",
    title: "delta",
    data: { delta },
  };
}

test("hot history collapses token deltas after the message ends; persist keeps every token", () => {
  resetHistory();
  publish(ev("d1", "Hel"));
  publish(ev("d2", "lo"));
  assert.equal(listEvents("run-hot-mem").length, 2);
  publish({
    id: "end",
    runId: "run-hot-mem",
    createdAt: "2026-08-22T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind: "message.end",
    title: "end",
  });
  const hot = listEvents("run-hot-mem");
  assert.equal(hot.length, 2);
  assert.equal(hot[0]?.id, "d2");
  assert.equal(hot[0]?.data?.delta, "Hello");
  assert.equal(hot[1]?.kind, "message.end");
  assert.equal(loadPersistedEvents("run-hot-mem").length, 3);
  dropHistory("run-hot-mem");
  assert.equal(listEvents("run-hot-mem").length, 0);
  const reloaded = eventsForRun("run-hot-mem");
  assert.equal(reloaded.filter((item) => item.kind === "message.delta").length, 1);
  assert.equal(reloaded.find((item) => item.kind === "message.delta")?.data?.delta, "Hello");
});
