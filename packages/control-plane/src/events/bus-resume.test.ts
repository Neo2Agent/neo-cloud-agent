import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "bus-resume-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-bus-"));
delete process.env.CONTROL_PLANE_TOKEN;

const { listEventsAfter, resetHistory, seedEvents } = await import("./bus.js");

function ev(id: string, kind: RunEvent["kind"], delta?: string): RunEvent {
  return {
    id,
    runId: "run-1",
    createdAt: "2026-08-24T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind,
    title: id,
    ...(delta !== undefined ? { data: { delta } } : {}),
  };
}

test("listEventsAfter does not replay the whole log when the cursor was compacted away", () => {
  resetHistory();
  seedEvents("run-1", [ev("s", "message.start"), ev("d2", "message.delta", "Hello"), ev("e", "message.end")]);
  assert.equal(listEventsAfter("run-1", "d1").length, 0);
  assert.deepEqual(
    listEventsAfter("run-1", "d2").map((item) => item.id),
    ["e"],
  );
});
