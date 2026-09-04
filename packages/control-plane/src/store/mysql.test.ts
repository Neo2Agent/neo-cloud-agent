import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import { databaseKindFromUrl } from "./database.js";
import { createMysqlMetadataStore } from "./mysql.js";

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
    prompt: "hello mysql",
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

test("DATABASE_URL scheme selects mysql or postgres", () => {
  assert.equal(databaseKindFromUrl("mysql://app:pw@127.0.0.1:3306/app"), "mysql");
  assert.equal(databaseKindFromUrl("postgres://neo:neo@127.0.0.1:5432/neo"), "postgres");
  assert.throws(() => databaseKindFromUrl("sqlite:///tmp/neo.db"), /unsupported DATABASE_URL/);
});

test("mysql store upserts run JSON, events, and users", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const rowsByQuery: Record<string, Array<Record<string, unknown>>> = {};
  const store = createMysqlMetadataStore(async (text, values) => {
    calls.push({ text, values: values ?? [] });
    const key = text.includes("LEFT JOIN run_queues")
      ? "run"
      : text.includes("FROM run_queues")
        ? "queues"
        : text.includes("FROM runs") && text.includes("title")
          ? "runs"
          : text.includes("FROM events")
            ? "events"
            : text.includes("FROM users WHERE email")
              ? "user"
              : text.includes("FROM users ORDER BY")
                ? "users"
                : "other";
    return { rows: rowsByQuery[key] ?? [] };
  });

  const record = { version: 1 as const, run: sampleRun("run-mysql-1"), followUps: [], inbound: [] };
  await store.saveRun(record);
  assert.match(calls[0]?.text ?? "", /INSERT INTO run_queues/);
  assert.match(calls[1]?.text ?? "", /INSERT INTO runs/);
  assert.match(calls[1]?.text ?? "", /ON DUPLICATE KEY UPDATE/);
  assert.equal(calls[1]?.values[0], "run-mysql-1");
  assert.equal(calls[1]?.values[1], "user_ada");
  assert.equal(calls[1]?.values[3], "hello mysql");

  const event = {
    id: "evt-1",
    runId: "run-mysql-1",
    createdAt: record.run.createdAt,
    category: "agent_run",
    level: "info",
    kind: "user.message",
    title: "User message",
    seq: 1,
  } satisfies RunEvent;
  await store.saveEvent(event);
  assert.match(calls.at(-1)?.text ?? "", /INSERT IGNORE INTO events/);

  rowsByQuery.run = [{ record, record_version: 2, follow_ups: [], inbound: [], subscriptions: [], active_turn: null }];
  const loaded = await store.loadRun("run-mysql-1");
  assert.equal(loaded?.run.prompt, "hello mysql");

  const older = { version: 1 as const, run: sampleRun("run-old"), followUps: [], inbound: [] };
  older.run.updatedAt = "2026-08-01T00:00:00.000Z";
  rowsByQuery.runs = [
    { record, record_version: 2, title: "hello mysql", status: "IDLE", project_id: null },
    { record: older, record_version: 1, title: null, status: "IDLE", project_id: null },
  ];
  rowsByQuery.queues = [];
  const listedRuns = await store.loadRuns();
  assert.equal(listedRuns[0]?.run.id, "run-mysql-1");
  const loadRunsSql = calls.find((item) => item.text.includes("SELECT id, user_id, org_id, title") && item.text.includes("deleted_at"))?.text ?? "";
  assert.match(loadRunsSql, /ORDER BY updated_at DESC/);
  assert.doesNotMatch(loadRunsSql, /JSON_EXTRACT/);

  const summaries = await store.loadRunSummaries();
  assert.equal(summaries[0]?.id, "run-mysql-1");
  assert.equal(summaries[0]?.title, "hello mysql");

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

  const automation = {
    id: "auto_1",
    name: "每天检查",
    enabled: true,
    prompt: "检查测试",
    repoUrls: ["fixtures/toy-repo"],
    schedule: { kind: "daily" as const, hour: 9 },
    nextRunAt: record.run.createdAt,
    userId: "user-1",
    orgId: "org_local",
    lastRunAt: null,
    lastRunId: null,
    lastError: null,
    createdAt: record.run.createdAt,
    updatedAt: record.run.createdAt,
  };
  await store.saveAutomation(automation);
  assert.match(calls.at(-1)?.text ?? "", /INSERT INTO automations/);

  await store.saveProject({
    id: "proj_1",
    name: "官网改版",
    instruction: "用中文回复",
    defaultRepoUrls: [],
    expertIds: [],
    pluginIds: [],
    invitePolicy: "open",
    createdBy: "user_ada",
    createdAt: record.run.createdAt,
    updatedAt: record.run.createdAt,
    members: [],
    invites: [],
    events: [],
  });
  assert.match(calls.at(-1)?.text ?? "", /INSERT INTO projects/);

  await store.saveExpertPolicy({
    version: 1,
    updatedAt: record.run.createdAt,
    experts: {
      exp_reviewer: {
        enabled: true,
        audience: "all",
        userIds: [],
        override: { name: "审查加强" },
        updatedAt: record.run.createdAt,
        publishedAt: null,
      },
    },
  });
  assert.match(calls.at(-1)?.text ?? "", /INSERT INTO expert_policies/);

  await store.saveExpert({
    id: "exp_mine",
    slug: "release-check",
    name: "发布检查",
    description: "发版前核对",
    persona: "You are a release checker.",
    methodology: "Read the diff.",
    deliverables: "## Notes",
    visibility: "user",
    ownerUserId: "user-1",
    createdAt: record.run.createdAt,
    updatedAt: record.run.createdAt,
  });
  assert.match(calls.at(-1)?.text ?? "", /INSERT INTO experts/);
});

test("mysql migrate adds deleted_at before indexing it", async () => {
  const calls: string[] = [];
  const store = createMysqlMetadataStore(async (text) => {
    calls.push(text);
    return { rows: [] };
  });
  await store.migrate();
  const addColumn = calls.findIndex((text) => /ALTER TABLE runs ADD COLUMN deleted_at/i.test(text));
  const addIndex = calls.findIndex((text) => /CREATE INDEX runs_deleted_at/i.test(text));
  assert.ok(addColumn >= 0);
  assert.ok(addIndex >= 0);
  assert.ok(addColumn < addIndex);
  assert.ok(calls.some((text) => /ALTER TABLE runs ADD COLUMN record_version/i.test(text)));
  assert.ok(calls.some((text) => /idx_runs_deleted_updated/i.test(text)));
});

test("migrate still succeeds when the backfill itself fails", async () => {
  const store = createMysqlMetadataStore(async (text) => {
    if (/record_version </.test(text)) {
      throw new Error("mysql went away");
    }
    return { rows: [] };
  });
  await store.migrate();
});

test("mysql backfill writes run_queues then marks record_version 2", async () => {
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-mysql-bf-"));
  const fat = {
    version: 1 as const,
    run: sampleRun("run-bf-1"),
    followUps: [{ id: "f1", runId: "run-bf-1", text: "queued", delivery: "follow_up" as const, status: "queued" as const, createdAt: "2026-09-04T00:00:00.000Z", deliveredAt: null }],
    inbound: [],
  };
  let pending = [{ id: "run-bf-1" }];
  let batch = [{ id: "run-bf-1", record: fat }];
  const updates: Array<{ text: string; values: unknown[] }> = [];
  const store = createMysqlMetadataStore(async (text, values) => {
    if (/SELECT id FROM runs WHERE record_version/.test(text) && /LIMIT 1/.test(text) && !/ORDER BY/.test(text)) {
      return { rows: pending };
    }
    if (/SELECT id, record FROM runs WHERE record_version/.test(text)) {
      return { rows: batch };
    }
    if (/INSERT INTO run_queues/.test(text) || /UPDATE runs SET record/.test(text)) {
      updates.push({ text, values: values ?? [] });
      pending = [];
      batch = [];
    }
    return { rows: [] };
  });
  await store.migrate();
  assert.ok(updates.some((item) => /INSERT INTO run_queues/.test(item.text)));
  const marked = updates.find((item) => /UPDATE runs SET record/.test(item.text));
  assert.ok(marked);
  assert.equal(marked?.values[4], 2);
});
