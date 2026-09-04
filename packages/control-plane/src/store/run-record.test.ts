import assert from "node:assert/strict";
import test from "node:test";
import type { FollowUp, Run } from "@neo-cloud-agent/contracts";
import type { PersistedRun } from "./persist.js";
import {
  applyRunIndexColumns,
  assertClientImages,
  BACKFILL_BATCH_SIZE,
  backfillRunRecords,
  collectObjectKeys,
  emptyRunQueue,
  inboxImageKey,
  InvalidImageRefError,
  isObjectImageRef,
  isOwnedInboxKey,
  mergeStoredRun,
  objectImageData,
  parseObjectImageKey,
  parseQueue,
  publicFollowUps,
  RECORD_VERSION_FAT,
  RECORD_VERSION_SLIM,
  runIndexTitle,
  runsBackupTableName,
  slimRunDocument,
  stripDeliveredImages,
  TITLE_MAX_LEN,
  UNNAMED_RUN_TITLE,
} from "./run-record.js";

function sampleRun(id = "run-1"): Run {
  const createdAt = "2026-09-04T00:00:00.000Z";
  return {
    id,
    orgId: "org_local",
    userId: "user_local",
    envId: null,
    envVersionId: null,
    buildId: null,
    status: "IDLE",
    setupStatus: null,
    source: "api",
    model: "neo/deepseek",
    prompt: "帮我改首页",
    branchName: null,
    baseBranch: null,
    repoUrls: [],
    pullRequests: [],
    workerHandle: null,
    createdAt,
    updatedAt: createdAt,
    idleAt: createdAt,
    expiresAt: null,
    errorMessage: null,
  };
}

function followUp(overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id: "f1",
    runId: "run-1",
    text: "再改配色",
    delivery: "follow_up",
    status: "queued",
    source: "user",
    createdAt: "2026-09-04T00:00:00.000Z",
    deliveredAt: null,
    ...overrides,
  };
}

test("runIndexTitle prefers title, then first prompt line, then fallback", () => {
  assert.equal(runIndexTitle({ title: "  已命名  ", prompt: "ignored" }), "已命名");
  assert.equal(runIndexTitle({ prompt: "第一行\n第二行" }), "第一行");
  assert.equal(runIndexTitle({ prompt: "   " }), UNNAMED_RUN_TITLE);
  assert.equal(runIndexTitle({ prompt: "x".repeat(TITLE_MAX_LEN + 10) }).length, TITLE_MAX_LEN);
});

test("owned inbox keys reject traversal and cross-run paths", () => {
  const key = inboxImageKey("run-1", "followup-f1-1");
  assert.equal(isOwnedInboxKey("run-1", key), true);
  assert.equal(isOwnedInboxKey("run-2", key), false);
  assert.equal(isOwnedInboxKey("run-1", "runs/run-1/inbox/../secret"), false);
  assert.equal(isOwnedInboxKey("run-1", "/runs/run-1/inbox/x"), false);
  assert.equal(isOwnedInboxKey("run-1", "runs/run-1/inbox/a/b"), false);
});

test("assertClientImages rejects obj prefixes", () => {
  assert.doesNotThrow(() => assertClientImages([{ mediaType: "image/png", data: "aW1n" }]));
  assert.throws(
    () => assertClientImages([{ mediaType: "image/png", data: objectImageData(inboxImageKey("other", "x")) }]),
    InvalidImageRefError,
  );
});

test("mergeStoredRun uses queues only when record_version is slim", () => {
  const run = sampleRun();
  const fat: PersistedRun = {
    version: 1,
    run,
    followUps: [followUp({ text: "from-record" })],
    inbound: [],
    subscriptions: [],
  };
  const queue = {
    followUps: [followUp({ text: "from-queue" })],
    inbound: [],
    subscriptions: [],
    activeTurn: null,
  };

  const v1 = mergeStoredRun(fat, emptyRunQueue(), RECORD_VERSION_FAT);
  assert.equal(v1?.followUps[0]?.text, "from-record");

  const v2 = mergeStoredRun(slimRunDocument(fat), queue, RECORD_VERSION_SLIM);
  assert.equal(v2?.followUps[0]?.text, "from-queue");

  const v2Missing = mergeStoredRun(slimRunDocument(fat), null, RECORD_VERSION_SLIM);
  assert.deepEqual(v2Missing?.followUps, []);
});

test("parseQueue treats a left-join null row as missing", () => {
  assert.equal(parseQueue(null), null);
  assert.equal(parseQueue({ follow_ups: null, inbound: null, subscriptions: null, active_turn: null }), null);
  const parsed = parseQueue({ follow_ups: "[]", inbound: "[]", subscriptions: "[]", active_turn: null });
  assert.deepEqual(parsed?.followUps, []);
  assert.equal(parsed?.activeTurn, null);
});

test("stripDeliveredImages keeps the entry and drops images", () => {
  const record: PersistedRun = {
    version: 1,
    run: sampleRun(),
    followUps: [
      followUp({
        status: "delivered",
        source: "user",
        images: [{ mediaType: "image/png", data: objectImageData(inboxImageKey("run-1", "followup-f1-1")) }],
      }),
    ],
    inbound: [],
  };
  const next = stripDeliveredImages(record);
  assert.equal(next.followUps[0]?.source, "user");
  assert.equal(next.followUps[0]?.images, undefined);
  assert.deepEqual([...collectObjectKeys(next)], []);
});

test("publicFollowUps never returns obj keys", () => {
  const items = [
    followUp({
      images: [{ mediaType: "image/png", data: objectImageData(inboxImageKey("run-1", "x")) }],
    }),
  ];
  const published = publicFollowUps(items, (images) => images);
  assert.equal(published[0]?.images?.length ?? 0, 0);
  const resolved = publicFollowUps(items, () => [{ mediaType: "image/png", data: "aW1n" }]);
  assert.equal(resolved[0]?.images?.[0]?.data, "aW1n");
  assert.equal(isObjectImageRef(resolved[0]?.images?.[0]?.data ?? ""), false);
});

test("applyRunIndexColumns overlays title from the index row", () => {
  const run = applyRunIndexColumns(sampleRun(), { title: "列标题", status: "RUNNING", project_id: "proj-1" });
  assert.equal(run.title, "列标题");
  assert.equal(run.status, "RUNNING");
  assert.equal(run.projectId, "proj-1");
});

test("backfillRunRecords probes, migrates a batch, then stops", async () => {
  let pendingRounds = 1;
  const migrated: string[] = [];
  await backfillRunRecords({
    hasPending: async () => {
      const pending = pendingRounds > 0;
      pendingRounds -= 1;
      return pending;
    },
    loadBatch: async () => [{ id: "run-1", record: { version: 1, run: sampleRun(), followUps: [], inbound: [] } }],
    parseRecord: (value) => value as PersistedRun,
    migrateRow: async (id) => {
      migrated.push(id);
    },
  });
  assert.deepEqual(migrated, ["run-1"]);
  assert.ok(BACKFILL_BATCH_SIZE > 0);
  assert.match(runsBackupTableName(new Date("2026-09-04T12:00:00.000Z")), /runs_backup_20260904/);
});

test("parseObjectImageKey only strips the prefix", () => {
  const key = inboxImageKey("run-1", "followup-f1-1");
  assert.equal(parseObjectImageKey(objectImageData(key)), key);
  assert.equal(parseObjectImageKey("aW1n"), null);
});
