import assert from "node:assert/strict";
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
    const key = text.includes("FROM runs WHERE")
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

  const record = {
    version: 1 as const,
    run: sampleRun("run-pg-1"),
    followUps: [
      {
        id: "f1",
        runId: "run-pg-1",
        text: "later",
        delivery: "prompt" as const,
        status: "queued" as const,
        createdAt: "2026-08-21T00:00:00.000Z",
        deliveredAt: null,
      },
    ],
    inbound: [],
  };
  await store.saveRun(record);
  assert.match(calls[0]?.text ?? "", /INSERT INTO runs/);
  assert.equal(calls[0]?.values[0], "run-pg-1");
  assert.equal(calls[0]?.values[1], "user_ada");
  assert.equal(calls[0]?.values[3], "hello postgres");
  assert.doesNotMatch(String(calls[0]?.values[6] ?? ""), /followUps/);
  assert.match(calls[1]?.text ?? "", /INSERT INTO run_queues/);

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

  rowsByQuery.run = [{ record: { version: 1, run: record.run } }];
  const loaded = await store.loadRun("run-pg-1");
  assert.equal(loaded?.run.prompt, "hello postgres");

  const slimStore = createPostgresMetadataStore(async (text) => {
    if (text.includes("FROM run_queues WHERE")) {
      return {
        rows: [
          {
            follow_ups: record.followUps,
            inbound: [],
            subscriptions: [],
            active_turn: null,
          },
        ],
      };
    }
    if (text.includes("FROM runs WHERE")) {
      return { rows: [{ record: { version: 1, run: record.run } }] };
    }
    return { rows: [] };
  });
  const merged = await slimStore.loadRun("run-pg-1");
  assert.equal(merged?.followUps[0]?.id, "f1");

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
