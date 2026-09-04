import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { FollowUp } from "@neo-cloud-agent/contracts";
import {
  listSessionFiles,
  loadPersistedEvents,
  loadPersistedQueue,
  loadPersistedRunDocument,
  loadPersistedRuns,
  loadSessionFiles,
  loadTranscriptSnapshot,
  peekLastPersistedEventId,
  persistEvent,
  persistRunRecord,
  persistSessionFiles,
  persistTranscriptSnapshot,
} from "./persist.js";
import { inboxImageKey, isObjectImageRef } from "./run-record.js";

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
    vmSlotId: "slot-0",
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
  persistRunRecord(
    {
      version: 1,
      run,
      followUps: [],
      inbound: [],
      subscriptions: [
        {
          id: "sub-1",
          runId: run.id,
          kind: "github_ci",
          repo: "acme/app",
          prNumber: 3,
          branch: "neo/demo",
          createdAt: run.createdAt,
          wakeCount: 0,
          lastDeliveryKey: null,
          lastDeliveredAt: null,
        },
      ],
    },
    runsDir,
  );
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
  assert.equal(loaded[0]?.run.vmSlotId, "slot-0");
  assert.equal(loaded[0]?.subscriptions?.[0]?.kind, "github_ci");
  const slim = loadPersistedRunDocument(run.id, runsDir);
  assert.equal((slim as { followUps?: unknown })?.followUps, undefined);
  assert.equal(loadPersistedQueue(run.id, runsDir)?.subscriptions?.[0]?.kind, "github_ci");
  const events = loadPersistedEvents(run.id, runsDir);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "user.message");
});

test("session backup keeps nested paths and rejects escapes", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-sess-"));
  const written = persistSessionFiles(
    "run-sess-1",
    [
      { name: "agent/turn.jsonl", content: "{\"type\":\"message\"}\n" },
      { name: "../escape.jsonl", content: "nope" },
      { name: "agent/auth.json", content: "{\"apiKey\":\"secret\"}" },
    ],
    runsDir,
  );
  assert.deepEqual(
    written.map((file) => file.name),
    ["agent/turn.jsonl"],
  );
  const listed = listSessionFiles("run-sess-1", runsDir);
  assert.equal(listed.some((file) => file.name === "agent/turn.jsonl"), true);
  assert.equal(listed.some((file) => file.name.includes("escape")), false);
  assert.equal(listed.some((file) => file.name.endsWith("auth.json")), false);
  const loaded = loadSessionFiles("run-sess-1", runsDir);
  assert.equal(loaded[0]?.content, "{\"type\":\"message\"}\n");
});

test("compiled transcript snapshots are not loaded as run records", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-snap-"));
  const run = sampleRun("run-snap-1");
  persistRunRecord({ version: 1, run, followUps: [], inbound: [] }, runsDir);
  persistEvent(
    {
      id: "evt-last",
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
  persistTranscriptSnapshot(
    {
      runId: run.id,
      seq: 1,
      lastEventId: "evt-last",
      messages: [{ id: "evt-last", role: "user", text: "hello", createdAt: run.createdAt }],
    },
    runsDir,
  );
  const loaded = loadPersistedRuns(runsDir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.run.id, run.id);
  assert.equal(peekLastPersistedEventId(run.id, runsDir), "evt-last");
  assert.equal(loadTranscriptSnapshot(run.id, runsDir)?.messages[0]?.text, "hello");
});

test("persist offloads queued images and still loads the original bytes", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-img-"));
  const run = sampleRun("run-img-1");
  const followUp: FollowUp = {
    id: "f-img",
    runId: run.id,
    text: "看这张",
    delivery: "follow_up",
    status: "queued",
    source: "user",
    createdAt: run.createdAt,
    deliveredAt: null,
    images: [{ mediaType: "image/png", data: "aW1nZGF0YQ" }],
  };
  persistRunRecord(
    {
      version: 1,
      run,
      followUps: [followUp],
      inbound: [{ type: "follow_up", text: "看这张", images: followUp.images, followUpId: followUp.id }],
    },
    runsDir,
  );
  const queue = loadPersistedQueue(run.id, runsDir);
  const stored = queue?.followUps[0]?.images?.[0]?.data ?? "";
  assert.equal(isObjectImageRef(stored), true);
  assert.ok(!JSON.stringify(queue).includes("aW1nZGF0YQ"));
  assert.equal(existsSync(path.join(runsDir, ".objects", ...inboxImageKey(run.id, "followup-f-img-1").split("/"))), true);
  const loaded = loadPersistedRuns(runsDir);
  assert.equal(loaded[0]?.followUps[0]?.images?.[0]?.data, "aW1nZGF0YQ");
});

test("delivered follow-ups keep the entry and drop images", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-deliv-"));
  const run = sampleRun("run-deliv-1");
  persistRunRecord(
    {
      version: 1,
      run,
      followUps: [
        {
          id: "f-deliv",
          runId: run.id,
          text: "已投递",
          delivery: "follow_up",
          status: "delivered",
          source: "user",
          createdAt: run.createdAt,
          deliveredAt: run.createdAt,
          images: [{ mediaType: "image/png", data: "aW1nZGF0YQ" }],
        },
      ],
      inbound: [],
    },
    runsDir,
  );
  const queue = loadPersistedQueue(run.id, runsDir);
  assert.equal(queue?.followUps[0]?.source, "user");
  assert.equal(queue?.followUps[0]?.images, undefined);
  assert.equal(existsSync(path.join(runsDir, ".objects", "runs", run.id, "inbox")), false);
});

test("legacy fat control json still loads when the queue file is missing", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-fat-"));
  const run = sampleRun("run-fat-1");
  const dir = path.join(runsDir, ".control");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${run.id}.json`),
    `${JSON.stringify({
      version: 1,
      run,
      followUps: [
        {
          id: "f-fat",
          runId: run.id,
          text: "旧肥包",
          delivery: "follow_up",
          status: "queued",
          createdAt: run.createdAt,
          deliveredAt: null,
        },
      ],
      inbound: [],
    })}\n`,
  );
  const loaded = loadPersistedRuns(runsDir);
  assert.equal(loaded[0]?.followUps[0]?.text, "旧肥包");
});
