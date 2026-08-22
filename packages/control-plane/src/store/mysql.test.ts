import assert from "node:assert/strict";
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
    const key = text.includes("FROM runs WHERE")
      ? "run"
      : text.includes("FROM events")
        ? "events"
        : text.includes("FROM users WHERE email")
          ? "user"
          : "other";
    return { rows: rowsByQuery[key] ?? [] };
  });

  const record = { version: 1 as const, run: sampleRun("run-mysql-1"), followUps: [], inbound: [] };
  await store.saveRun(record);
  assert.match(calls[0]?.text ?? "", /INSERT INTO runs/);
  assert.match(calls[0]?.text ?? "", /ON DUPLICATE KEY UPDATE/);
  assert.equal(calls[0]?.values[0], "run-mysql-1");
  assert.equal(calls[0]?.values[1], "user_ada");

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

  rowsByQuery.run = [{ record }];
  const loaded = await store.loadRun("run-mysql-1");
  assert.equal(loaded?.run.prompt, "hello mysql");

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
});
