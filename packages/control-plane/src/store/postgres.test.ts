import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import { createPostgresMetadataStore } from "./postgres.js";

function sampleRun(id: string): Run {
  const createdAt = "2026-08-21T00:00:00.000Z";
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
    prompt: "hello postgres",
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

test("postgres store upserts run JSON, events, and users", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const rowsByQuery: Record<string, Array<Record<string, unknown>>> = {};
  const store = createPostgresMetadataStore(async (text, values) => {
    calls.push({ text, values: values ?? [] });
    const key = text.includes("LEFT JOIN run_queues")
      ? "run"
      : text.includes("FROM events")
        ? "events"
        : text.includes("FROM users WHERE email")
          ? "user"
          : text.includes("FROM users ORDER BY")
            ? "users"
            : "other";
    return { rows: rowsByQuery[key] ?? [] };
  });

  const record = { version: 1 as const, run: sampleRun("run-pg-1"), followUps: [], inbound: [] };
  await store.saveRun(record);
  assert.match(calls[0]?.text ?? "", /INSERT INTO run_queues/);
  assert.match(calls[1]?.text ?? "", /INSERT INTO runs/);
  assert.equal(calls[1]?.values[0], "run-pg-1");
  assert.equal(calls[1]?.values[1], "user_ada");
  assert.equal(calls[1]?.values[3], "hello postgres");

  const event = {
    id: "evt-1",
    runId: "run-pg-1",
    createdAt: record.run.createdAt,
    category: "agent_run",
    level: "info",
    kind: "user.message",
    title: "User message",
    seq: 1,
  } satisfies RunEvent;
  await store.saveEvent(event);
  assert.match(calls.at(-1)?.text ?? "", /INSERT INTO events/);
  assert.match(calls.at(-1)?.text ?? "", /image_version, has_images/);
  assert.equal(calls.at(-1)?.values[4], 1);
  assert.equal(calls.at(-1)?.values[5], 0);

  rowsByQuery.run = [{ record, record_version: 2, follow_ups: [], inbound: [], subscriptions: [], active_turn: null }];
  const loaded = await store.loadRun("run-pg-1");
  assert.equal(loaded?.run.prompt, "hello postgres");

  await store.createUser({
    id: "user-1",
    email: "ada@example.com",
    passwordHash: "scrypt$x",
    orgId: "org_local",
    createdAt: record.run.createdAt,
  });
  assert.match(calls.at(-1)?.text ?? "", /INSERT INTO users/);
  rowsByQuery.user = [
    {
      id: "user-1",
      email: "ada@example.com",
      password_hash: "scrypt$x",
      org_id: "org_local",
      created_at: record.run.createdAt,
    },
  ];
  const user = await store.findUserByEmail("ada@example.com");
  assert.equal(user?.id, "user-1");
  rowsByQuery.users = rowsByQuery.user;
  const listed = await store.listUsers();
  assert.equal(listed[0]?.email, "ada@example.com");
  assert.match(calls.at(-1)?.text ?? "", /FROM users ORDER BY created_at/);

  await store.saveEnvironment({
    id: "env-1",
    orgId: "org_local",
    name: "toy",
    environmentJsonPath: null,
    config: { repos: ["fixtures/toy-repo"] },
    secrets: [],
    createdAt: record.run.createdAt,
    updatedAt: record.run.createdAt,
  });
  assert.match(calls.at(-1)?.text ?? "", /INSERT INTO environments/);
  await store.saveBuild({
    id: "build-1",
    envId: "env-1",
    envVersionId: "env-1",
    orgId: "org_local",
    status: "SUCCEEDED",
    source: "manual",
    draft: false,
    snapshotId: "snap_build-1",
    snapshotPath: "/tmp/snap",
    fingerprint: "abc",
    repoUrls: ["fixtures/toy-repo"],
    ref: null,
    createdAt: record.run.createdAt,
    completedAt: record.run.createdAt,
    failureMessage: null,
  });
  assert.match(calls.at(-1)?.text ?? "", /INSERT INTO builds/);
});

test("postgres migrate still succeeds when event image backfill fails", async () => {
  const store = createPostgresMetadataStore(async (text) => {
    if (/image_version </.test(text)) {
      throw new Error("postgres went away");
    }
    return { rows: [] };
  });
  await store.migrate();
});

test("postgres event image backfill probes without body and marks image_version 1", async () => {
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-pg-evt-"));
  const fat = {
    id: "evt-1",
    runId: "run-evt-1",
    createdAt: "2026-09-04T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind: "user.message",
    title: "User message",
    seq: 1,
    data: { text: "旧图", images: [{ mediaType: "image/png", data: "aW1nZGF0YQ" }] },
  };
  let pending = [{ event_id: "evt-1" }];
  let batch = [{ run_id: "run-evt-1", event_id: "evt-1", seq: 1, body: fat }];
  const updates: Array<{ text: string; values: unknown[] }> = [];
  const store = createPostgresMetadataStore(async (text, values) => {
    if (/SELECT event_id FROM events WHERE image_version/.test(text) && /LIMIT 1/.test(text) && !/ORDER BY/.test(text)) {
      assert.doesNotMatch(text, /\bbody\b/);
      return { rows: pending };
    }
    if (/SELECT run_id, event_id, seq, body FROM events WHERE image_version/.test(text)) {
      return { rows: batch };
    }
    if (/UPDATE events SET body/.test(text)) {
      updates.push({ text, values: values ?? [] });
      pending = [];
      batch = [];
    }
    return { rows: [] };
  });
  await store.migrate();
  const marked = updates.find((item) => /UPDATE events SET body/.test(item.text));
  assert.ok(marked);
  assert.equal(marked?.values[1], 1);
  assert.equal(marked?.values[2], 1);
  assert.ok(!String(marked?.values[0]).includes("aW1nZGF0YQ"));
});
