import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import { actorIsPlatformAdmin, isAdminLogin } from "../security/actor.js";
import { adminRunsLimit, buildAdminRunRows, buildAdminUserRows } from "./overview.js";

function run(partial: Partial<Run> & Pick<Run, "id" | "userId">): Run {
  const createdAt = partial.createdAt ?? "2026-08-20T00:00:00.000Z";
  return {
    id: partial.id,
    orgId: partial.orgId ?? "org_local",
    userId: partial.userId,
    envId: null,
    envVersionId: null,
    buildId: null,
    status: partial.status ?? "IDLE",
    setupStatus: "INSTALL_SUCCEEDED",
    source: partial.source ?? "web",
    model: partial.model ?? "neo/deepseek",
    prompt: partial.prompt ?? "hello",
    branchName: null,
    baseBranch: null,
    repoUrls: [],
    pullRequests: [],
    workerHandle: null,
    createdAt,
    updatedAt: partial.updatedAt ?? createdAt,
    idleAt: createdAt,
    expiresAt: null,
    errorMessage: null,
    usage: partial.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

test("isAdminLogin treats admin, ADMIN_EMAILS, and service tokens as platform admin", () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "Ops@Example.com, mate";
  try {
    assert.equal(isAdminLogin("admin"), true);
    assert.equal(isAdminLogin("Admin"), true);
    assert.equal(isAdminLogin("ops@example.com"), true);
    assert.equal(isAdminLogin("mate"), true);
    assert.equal(isAdminLogin("ada@example.com"), false);
    assert.equal(actorIsPlatformAdmin({ kind: "service", userId: "svc", orgId: "org" }), true);
    assert.equal(
      actorIsPlatformAdmin({ kind: "user", userId: "u1", orgId: "org", email: "admin", sessionId: "s" }),
      true,
    );
    assert.equal(
      actorIsPlatformAdmin({ kind: "user", userId: "u2", orgId: "org", email: "ada@example.com", sessionId: "s" }),
      false,
    );
    assert.equal(actorIsPlatformAdmin({ kind: "anonymous", userId: "anon", orgId: "org" }), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});

test("admin user rows sort by utilization and never expose password hashes", () => {
  const users = [
    { id: "u-ada", email: "ada@example.com", orgId: "org_local", createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "u-admin", email: "admin", orgId: "org_local", createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "u-idle", email: "idle", orgId: "org_local", createdAt: "2026-08-02T00:00:00.000Z" },
  ];
  const now = new Date("2026-08-25T12:00:00.000Z");
  const rows = buildAdminUserRows(
    users,
    [
      run({
        id: "r1",
        userId: "u-ada",
        status: "RUNNING",
        createdAt: "2026-08-20T00:00:00.000Z",
        updatedAt: "2026-08-25T01:00:00.000Z",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
      run({
        id: "r2",
        userId: "u-admin",
        status: "IDLE",
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      }),
    ],
    now,
  );
  assert.equal(rows[0]?.email, "ada@example.com");
  assert.equal(rows[0]?.concurrentRuns, 1);
  assert.equal(rows[0]?.usedTokensMonth, 15);
  assert.equal(rows[1]?.email, "admin");
  assert.equal(rows[1]?.admin, true);
  assert.equal(rows[1]?.usedTokensMonth, 120);
  assert.equal(rows[2]?.email, "idle");
  assert.equal(rows[2]?.runCount, 0);
  assert.equal(rows.every((row) => !("passwordHash" in row)), true);
});

test("admin run rows are newest first and honor the limit cap", () => {
  const rows = buildAdminRunRows(
    [
      run({ id: "old", userId: "u1", updatedAt: "2026-08-20T00:00:00.000Z", prompt: "old" }),
      run({ id: "new", userId: "u2", updatedAt: "2026-08-25T00:00:00.000Z", prompt: "new" }),
    ],
    1,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "new");
  assert.equal(adminRunsLimit("12"), 12);
  assert.equal(adminRunsLimit("9999"), 500);
  assert.equal(adminRunsLimit("nope"), 100);
});
