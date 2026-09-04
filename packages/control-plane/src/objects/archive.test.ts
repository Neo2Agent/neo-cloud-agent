import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import { persistEvent, persistRunRecord, persistSessionFiles, loadPersistedEvents, loadPersistedQueue, loadPersistedRun, loadPersistedRunDocument, loadSessionFiles } from "../store/persist.js";
import { eventImageKey, resolveEventImageData } from "../store/event-images.js";
import { isObjectImageRef } from "../store/run-record.js";
import { archiveRunArtifacts, restoreArchivedArtifacts } from "./archive.js";
import { createMemoryObjectStore } from "./memory.js";
import { artifactKey, getObjectStore, setObjectStoreForTests } from "./store.js";

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

test("restore does not overwrite a soft-deleted run record", async () => {
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-archive-del-"));
  setObjectStoreForTests(createMemoryObjectStore());
  const run = sampleRun("run-archive-deleted");
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
  await archiveRunArtifacts(run.id);

  const deleted = { ...run, deletedAt: "2026-08-31T00:00:00.000Z", status: "ARCHIVED" as const };
  persistRunRecord({ version: 1, run: deleted, followUps: [], inbound: [] });

  const restored = await restoreArchivedArtifacts(run.id);
  assert.equal(restored?.record?.run.deletedAt, "2026-08-31T00:00:00.000Z");
  assert.equal(loadPersistedRun(run.id)?.run.deletedAt, "2026-08-31T00:00:00.000Z");
  setObjectStoreForTests(null);
});

test("archive writes a slim record and inbox objects without resolving base64", async () => {
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-archive-img-"));
  setObjectStoreForTests(createMemoryObjectStore());
  const run = sampleRun("run-archive-img");
  persistRunRecord({
    version: 1,
    run,
    followUps: [
      {
        id: "f-arch",
        runId: run.id,
        text: "看图",
        delivery: "follow_up",
        status: "queued",
        source: "user",
        createdAt: run.createdAt,
        deliveredAt: null,
        images: [{ mediaType: "image/png", data: "aW1nZGF0YQ" }],
      },
    ],
    inbound: [],
  });
  await archiveRunArtifacts(run.id);
  const store = getObjectStore();
  const recordRaw = await store.get(artifactKey(run.id, "record.json"));
  assert.ok(recordRaw);
  assert.ok(!recordRaw.includes("aW1nZGF0YQ"));
  assert.equal(JSON.parse(recordRaw).followUps, undefined);
  const queueRaw = await store.get(artifactKey(run.id, "queue.json"));
  assert.ok(queueRaw);
  assert.equal(isObjectImageRef(JSON.parse(queueRaw).followUps[0].images[0].data), true);
  assert.equal(await store.get(`runs/${run.id}/inbox/followup-f-arch-1`), "aW1nZGF0YQ");

  rmSync(path.join(process.env.RUNS_DIR, ".control"), { recursive: true, force: true });
  rmSync(path.join(process.env.RUNS_DIR, ".objects"), { recursive: true, force: true });
  const restored = await restoreArchivedArtifacts(run.id);
  assert.equal(loadPersistedRun(run.id)?.followUps[0]?.images?.[0]?.data, "aW1nZGF0YQ");
  assert.equal(loadPersistedRunDocument(run.id)?.followUps, undefined);
  assert.equal(isObjectImageRef(loadPersistedQueue(run.id)?.followUps[0]?.images?.[0]?.data ?? ""), true);
  assert.equal(restored?.record?.run.prompt, "hello");
  setObjectStoreForTests(null);
});

test("archive copies event image objects so restore still serves transcript bytes", async () => {
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-archive-evt-"));
  setObjectStoreForTests(createMemoryObjectStore());
  const run = sampleRun("run-archive-evt");
  persistRunRecord({ version: 1, run, followUps: [], inbound: [] });
  persistEvent({
    id: "evt-img",
    runId: run.id,
    createdAt: run.createdAt,
    category: "agent_run",
    level: "info",
    kind: "user.message",
    title: "User message",
    data: { text: "看图", images: [{ mediaType: "image/png", data: "aW1nZGF0YQ" }] },
  } satisfies RunEvent);
  await archiveRunArtifacts(run.id);
  const store = getObjectStore();
  const eventsRaw = await store.get(artifactKey(run.id, "events.jsonl"));
  assert.ok(eventsRaw);
  assert.ok(!eventsRaw.includes("aW1nZGF0YQ"));
  assert.equal(await store.get(eventImageKey(run.id, "evt-img", 0)), "aW1nZGF0YQ");

  rmSync(path.join(process.env.RUNS_DIR, ".control"), { recursive: true, force: true });
  rmSync(path.join(process.env.RUNS_DIR, ".objects"), { recursive: true, force: true });
  await restoreArchivedArtifacts(run.id);
  const stored = (loadPersistedEvents(run.id)[0]?.data?.images as Array<{ data: string }>)[0]?.data ?? "";
  assert.equal(isObjectImageRef(stored), true);
  assert.equal(resolveEventImageData(run.id, stored), "aW1nZGF0YQ");
  setObjectStoreForTests(null);
});
