import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";

process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-snapshot-heal-"));

const { persistEvent, persistTranscriptSnapshot, loadTranscriptSnapshot } = await import("../store/persist.js");
const { dropHistory } = await import("./bus.js");
const { snapshotForRun } = await import("./snapshot.js");

function ev(partial: Partial<RunEvent> & Pick<RunEvent, "id" | "kind">): RunEvent {
  return {
    runId: "run-stale-1",
    createdAt: "2026-08-21T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    title: partial.kind,
    ...partial,
  };
}

test("stale cached snapshots with running tools rebuild after agent.end", () => {
  const runId = "run-stale-1";
  const events = [
    ev({ id: "u1", kind: "user.message", data: { text: "ls" } }),
    ev({
      id: "t1",
      kind: "tool.start",
      data: { toolCallId: "c1", toolName: "ls" },
    }),
    ev({ id: "z1", kind: "agent.end" }),
  ];
  for (const event of events) {
    persistEvent(event);
  }
  persistTranscriptSnapshot({
    runId,
    seq: 3,
    lastEventId: "z1",
    messages: [
      { id: "u1", role: "user", text: "ls", createdAt: events[0]!.createdAt },
      {
        id: "t1",
        role: "assistant",
        text: "",
        createdAt: events[1]!.createdAt,
        tools: [{ id: "c1", name: "ls", status: "running" }],
      },
    ],
  });
  dropHistory(runId);
  const snapshot = snapshotForRun(runId);
  assert.equal(snapshot.messages.find((item) => item.role === "assistant")?.tools?.[0]?.status, "done");
  assert.equal(loadTranscriptSnapshot(runId)?.messages.find((item) => item.role === "assistant")?.tools?.[0]?.status, "done");
});
