import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import { loadPersistedEvents, loadPersistedRuns, persistEvent, persistRunRecord } from "./persist.js";

function sampleRun(id: string): Run {
  const createdAt = "2026-08-21T00:00:00.000Z";
  return {
    id,
    orgId: "org_local",
    userId: "user_local",
    envId: null,
    envVersionId: null,
    buildId: null,
    status: "IDLE",
    setupStatus: "INSTALL_SUCCEEDED",
    source: "api",
    model: "neo/deepseek",
    prompt: "hello",
    branchName: null,
    repoUrls: ["fixtures/toy-repo"],
    workerHandle: "none-1",
    createdAt,
    updatedAt: createdAt,
    idleAt: createdAt,
    expiresAt: null,
    errorMessage: null,
  };
}

test("persists a run record and JSONL events next to the workspace dir", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-"));
  const run = sampleRun("run-persist-1");
  persistRunRecord({ version: 1, run, followUps: [], inbound: [] }, runsDir);
  persistEvent(
    {
      id: "evt-1",
      runId: run.id,
      createdAt: run.createdAt,
      category: "agent_run",
      level: "info",
      kind: "user.message",
      title: "User message",
      data: { text: "hello" },
    } satisfies RunEvent,
    runsDir,
  );

  const loaded = loadPersistedRuns(runsDir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.run.prompt, "hello");
  assert.equal(loaded[0]?.run.setupStatus, "INSTALL_SUCCEEDED");
  const events = loadPersistedEvents(run.id, runsDir);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "user.message");
});
