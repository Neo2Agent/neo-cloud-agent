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
          : "other";
    return { rows: rowsByQuery[key] ?? [] };
  });

  const record = { version: 1 as const, run: sampleRun("run-pg-1"), followUps: [], inbound: [] };
  await store.saveRun(record);
  assert.match(calls[0]?.text ?? "", /INSERT INTO runs/);
  assert.equal(calls[0]?.values[0], "run-pg-1");
  assert.equal(calls[0]?.values[1], "user_ada");

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

  rowsByQuery.run = [{ record }];
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
});
