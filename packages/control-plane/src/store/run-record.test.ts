import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import {
  inboxImageRefKey,
  isInboxImageKey,
  mergeStoredRun,
  parseQueue,
  queueFromRecord,
  recordHasEmbeddedQueue,
  recordHasQueueKeys,
  runIndexTitle,
  slimRunDocument,
} from "./run-record.js";

function sampleRun(id: string): Run {
  return {
    id,
    orgId: "org_local",
    userId: "user_ada",
    envId: null,
    envVersionId: null,
    buildId: null,
    status: "IDLE",
    setupStatus: "INSTALL_SUCCEEDED",
    source: "web",
    model: "neo/deepseek",
    prompt: "hello\nsecond line",
    title: "短标题",
    branchName: null,
    baseBranch: null,
    repoUrls: [],
    pullRequests: [],
    workerHandle: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    idleAt: null,
    expiresAt: null,
    errorMessage: null,
  };
}

test("slim run document drops queues so the list row cannot grow with follow-ups", () => {
  const run = sampleRun("run-1");
  const record = {
    version: 1 as const,
    run,
    followUps: [{ id: "f1", runId: run.id, text: "more", delivery: "prompt" as const, status: "queued" as const, createdAt: run.createdAt, deliveredAt: null }],
    inbound: [{ type: "prompt" as const, text: "more" }],
    subscriptions: [],
    activeTurn: { type: "prompt" as const, text: "more" },
  };
  assert.deepEqual(slimRunDocument(record), { version: 1, run });
  assert.equal(recordHasEmbeddedQueue(record), true);
  assert.equal(queueFromRecord(record).followUps[0]?.id, "f1");
});

test("mergeStoredRun accepts a slim document plus a queue row", () => {
  const run = sampleRun("run-2");
  const merged = mergeStoredRun(
    { version: 1, run },
    { follow_ups: [{ id: "f2", runId: run.id, text: "later", delivery: "prompt", status: "queued", createdAt: run.createdAt, deliveredAt: null }], inbound: [], subscriptions: [] },
  );
  assert.equal(merged?.run.id, "run-2");
  assert.equal(merged?.followUps[0]?.id, "f2");
});

test("mergeStoredRun still reads a legacy fat record", () => {
  const run = sampleRun("run-3");
  const merged = mergeStoredRun({
    version: 1,
    run,
    followUps: [{ id: "f3", runId: run.id, text: "old", delivery: "prompt", status: "queued", createdAt: run.createdAt, deliveredAt: null }],
    inbound: [],
  });
  assert.equal(merged?.followUps[0]?.id, "f3");
  assert.equal(recordHasQueueKeys({ version: 1, run, followUps: [] }), true);
  assert.equal(recordHasQueueKeys({ version: 1, run }), false);
});

test("runIndexTitle prefers the stored title over the first prompt line", () => {
  assert.equal(runIndexTitle({ title: "分析会话存储", prompt: "帮我看看\n后面还有" }), "分析会话存储");
  assert.equal(runIndexTitle({ prompt: "帮我看看\n后面还有" }), "帮我看看");
});

test("inbox image keys are distinct from raw base64", () => {
  const key = inboxImageRefKey("run-4", "followup-1-1");
  assert.equal(isInboxImageKey(key), true);
  assert.equal(isInboxImageKey("ZmFrZQ"), false);
});

test("parseQueue treats a left-join null row as missing so a legacy fat record stays intact", () => {
  assert.equal(parseQueue({ follow_ups: null, inbound: null, subscriptions: null, active_turn: null }), null);
  assert.deepEqual(parseQueue({ followUps: [], inbound: [], subscriptions: [] }), {
    followUps: [],
    inbound: [],
    subscriptions: [],
    activeTurn: null,
  });
});
