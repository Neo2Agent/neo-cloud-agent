import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import { persistEvent, persistRunRecord, persistSessionFiles, loadPersistedEvents, loadPersistedRun, loadSessionFiles } from "../store/persist.js";
import { archiveRunArtifacts, restoreArchivedArtifacts } from "./archive.js";
import { createMemoryObjectStore } from "./memory.js";
import { setObjectStoreForTests } from "./store.js";

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
    baseBranch: null,
    repoUrls: ["fixtures/toy-repo"],
    pullRequests: [],
    workerHandle: "none-1",
    createdAt,
    updatedAt: createdAt,
    idleAt: createdAt,
    expiresAt: null,
    errorMessage: null,
  };
}

test("archives transcript and session then restores them from the object store", async () => {
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-archive-"));
  setObjectStoreForTests(createMemoryObjectStore());
  const run = sampleRun("run-archive-1");
  persistRunRecord({ version: 1, run, followUps: [], inbound: [] });
  persistEvent({
    id: "evt-1",
    runId: run.id,
    createdAt: run.createdAt,
    category: "agent_run",
    level: "info",
    kind: "user.message",
    title: "User message",
    data: { text: "hello" },
  } satisfies RunEvent);
  persistSessionFiles(run.id, [{ name: "agent/turn.jsonl", content: "{\"ok\":true}\n" }]);

  await archiveRunArtifacts(run.id);
  rmSync(path.join(process.env.RUNS_DIR, ".control"), { recursive: true, force: true });
  assert.equal(loadPersistedRun(run.id), null);

  const restored = await restoreArchivedArtifacts(run.id);
  assert.equal(restored?.record?.run.prompt, "hello");
  assert.equal(loadPersistedEvents(run.id)[0]?.kind, "user.message");
  assert.equal(loadSessionFiles(run.id)[0]?.name, "agent/turn.jsonl");
  setObjectStoreForTests(null);
});

test("restore does not overwrite a soft-deleted persist record", async () => {
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-archive-deleted-"));
  setObjectStoreForTests(createMemoryObjectStore());
  const run = sampleRun("run-archive-deleted");
  persistRunRecord({ version: 1, run, followUps: [], inbound: [] });
  await archiveRunArtifacts(run.id);
  persistRunRecord({
    version: 1,
    run: { ...run, status: "ARCHIVED", deletedAt: "2026-08-31T00:00:00.000Z" },
    followUps: [],
    inbound: [],
  });

  const restored = await restoreArchivedArtifacts(run.id);
  assert.equal(restored?.record?.run.deletedAt, "2026-08-31T00:00:00.000Z");
  assert.equal(loadPersistedRun(run.id)?.run.deletedAt, "2026-08-31T00:00:00.000Z");
  setObjectStoreForTests(null);
});
