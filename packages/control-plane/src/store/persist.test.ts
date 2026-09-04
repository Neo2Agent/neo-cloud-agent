import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import {
  listSessionFiles,
  loadPersistedEvents,
  loadPersistedRun,
  loadPersistedRuns,
  loadSessionFiles,
  loadTranscriptSnapshot,
  peekLastPersistedEventId,
  persistEvent,
  persistRunRecord,
  persistSessionFiles,
  persistTranscriptSnapshot,
} from "./persist.js";

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
  const document = JSON.parse(readFileSync(path.join(runsDir, ".control", `${run.id}.json`), "utf8")) as {
    followUps?: unknown;
    run: { prompt: string };
  };
  assert.equal(document.followUps, undefined);
  assert.equal(document.run.prompt, "hello");
  const queue = JSON.parse(readFileSync(path.join(runsDir, ".control", `${run.id}.queue.json`), "utf8")) as {
    subscriptions?: Array<{ kind: string }>;
  };
  assert.equal(queue.subscriptions?.[0]?.kind, "github_ci");
  const events = loadPersistedEvents(run.id, runsDir);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "user.message");
});

test("follow-up images live in object files, not the run or queue json", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-img-"));
  const run = sampleRun("run-img-1");
  persistRunRecord(
    {
      version: 1,
      run,
      followUps: [
        {
          id: "f1",
          runId: run.id,
          text: "see",
          delivery: "prompt",
          status: "queued",
          createdAt: run.createdAt,
          deliveredAt: null,
          images: [{ mediaType: "image/jpeg", data: "ZmFrZQ" }],
        },
      ],
      inbound: [],
    },
    runsDir,
  );
  const documentRaw = readFileSync(path.join(runsDir, ".control", `${run.id}.json`), "utf8");
  const queueRaw = readFileSync(path.join(runsDir, ".control", `${run.id}.queue.json`), "utf8");
  assert.doesNotMatch(documentRaw, /ZmFrZQ/);
  assert.doesNotMatch(queueRaw, /ZmFrZQ/);
  const queue = JSON.parse(queueRaw) as { followUps: Array<{ images?: Array<{ data: string }> }> };
  assert.match(queue.followUps[0]?.images?.[0]?.data ?? "", /^obj:/);
  const loaded = loadPersistedRuns(runsDir);
  assert.equal(loaded[0]?.followUps[0]?.images?.[0]?.data, "ZmFrZQ");
});

test("loadPersistedRun still reads a legacy fat control file", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-persist-legacy-"));
  const run = sampleRun("run-legacy-1");
  mkdirSync(path.join(runsDir, ".control"), { recursive: true });
  writeFileSync(
    path.join(runsDir, ".control", `${run.id}.json`),
    `${JSON.stringify({
      version: 1,
      run,
      followUps: [
        {
          id: "f-legacy",
          runId: run.id,
          text: "old queue",
          delivery: "prompt",
          status: "queued",
          createdAt: run.createdAt,
          deliveredAt: null,
        },
      ],
      inbound: [],
    })}\n`,
  );
  const loaded = loadPersistedRun(run.id, runsDir);
  assert.equal(loaded?.followUps[0]?.id, "f-legacy");
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
