import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import { persistRunRecord } from "../../control-plane/src/store/persist.js";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "admin-api-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-admin-api-"));
process.env.ACCOUNTS_REQUIRED = "1";
process.env.CONTROL_PLANE_TOKEN = "admin-api-token";
process.env.NEW_API_CONSOLE_URL = "http://127.0.0.1:3000";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.ADMIN_EMAILS;

const { createAdminApiServer } = await import("./server.js");
const { createTeammateAccount, ensureDefaultAdmin, loginAccount, registerAccount } = await import(
  "../../control-plane/src/accounts/accounts.js"
);
const { listen, close } = await import("../../control-plane/src/e2e/helpers.js");

const SERVICE = { authorization: "Bearer admin-api-token" };

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return {
    status: response.status,
    cookie: response.headers.get("set-cookie") ?? "",
    body: (await response.json()) as {
      token?: string;
      user?: { id: string; email: string; orgId: string };
      admin?: boolean;
      error?: string;
    },
  };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

test("admin-api is a separate app and only platform admins can use it", async (t) => {
  const server = createAdminApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();

  const denied = await fetch(`${base}/v1/admin/overview`);
  assert.equal(denied.status, 401);

  const admin = await login(base, "admin", "123456");
  assert.equal(admin.status, 200);
  assert.equal(admin.body.admin, true);
  assert.ok(admin.body.token);
  assert.match(admin.cookie, /neo_admin_session=/);
  assert.doesNotMatch(admin.cookie, /neo_session=/);

  const mateUser = await createTeammateAccount({
    email: "mate",
    password: "654321",
    orgId: admin.body.user?.orgId ?? "org_local",
  });
  const mate = await login(base, "mate", "654321");
  assert.equal(mate.status, 403);
  assert.equal(mate.body.error, "admin_required");

  persistRunRecord({
    version: 1,
    followUps: [],
    inbound: [],
    run: {
      id: "run-mate-1",
      orgId: mateUser.orgId,
      userId: mateUser.id,
      envId: null,
      envVersionId: null,
      buildId: null,
      status: "RUNNING",
      setupStatus: "INSTALL_SUCCEEDED",
      source: "web",
      model: "neo/deepseek",
      prompt: "mate 的演示对话",
      branchName: null,
      baseBranch: null,
      repoUrls: [],
      pullRequests: [],
      workerHandle: null,
      createdAt: "2026-08-25T09:00:00.000Z",
      updatedAt: "2026-08-25T09:01:00.000Z",
      idleAt: null,
      expiresAt: null,
      errorMessage: null,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } satisfies Run,
  });

  const overview = await fetch(`${base}/v1/admin/overview`, { headers: auth(admin.body.token!) });
  assert.equal(overview.status, 200);
  const overviewBody = (await overview.json()) as {
    users: { total: number; admins: number };
    runs: { total: number; live: number };
    newApi: { consoleUrl: string | null };
  };
  assert.ok(overviewBody.users.total >= 2);
  assert.equal(overviewBody.users.admins, 1);
  assert.ok(overviewBody.runs.total >= 1);
  assert.equal(overviewBody.newApi.consoleUrl, "http://127.0.0.1:3000");

  const users = await fetch(`${base}/v1/admin/users`, { headers: auth(admin.body.token!) });
  const usersBody = (await users.json()) as { users: Array<{ email: string; runCount: number; admin: boolean }> };
  assert.equal(JSON.stringify(usersBody).includes("passwordHash"), false);
  assert.equal(usersBody.users.some((row) => row.email === "mate" && row.runCount >= 1 && !row.admin), true);

  const pending = await registerAccount({ username: "newbie", phone: "13700137000", password: "password1" });
  assert.equal(pending.user.status, "pending");
  const afterRegister = await fetch(`${base}/v1/admin/users`, { headers: auth(admin.body.token!) });
  const afterRegisterBody = (await afterRegister.json()) as {
    users: Array<{ id: string; email: string; status?: string; creditFen?: number }>;
  };
  assert.equal(afterRegisterBody.users.some((row) => row.email === "newbie" && row.status === "pending" && row.creditFen === 500), true);
  const approved = await fetch(`${base}/v1/admin/users/${pending.user.id}/approve`, {
    method: "POST",
    headers: auth(admin.body.token!),
  });
  assert.equal(approved.status, 200);
  const session = await loginAccount({ email: "13700137000", password: "password1" });
  assert.equal(session.user.status, "active");
  assert.equal(session.user.creditFen, 500);

  const runs = await fetch(`${base}/v1/admin/runs`, { headers: auth(admin.body.token!) });
  const runsBody = (await runs.json()) as { runs: Array<{ prompt: string }> };
  assert.equal(runsBody.runs.some((row) => row.prompt === "mate 的演示对话"), true);

  const service = await fetch(`${base}/v1/admin/overview`, { headers: SERVICE });
  assert.equal(service.status, 200);

  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "mate";
  try {
    const promoted = await login(base, "mate", "654321");
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.admin, true);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }

  const health = await fetch(`${base}/health`);
  assert.equal(((await health.json()) as { service?: string }).service, "admin-api");

  const experts = await fetch(`${base}/v1/admin/experts`, { headers: auth(admin.body.token!) });
  assert.equal(experts.status, 200);
  const catalog = (await experts.json()) as {
    experts: Array<{ id: string; live: { name: string }; enabled: boolean }>;
    users: Array<{ id: string; email: string }>;
  };
  assert.ok(catalog.experts.some((item) => item.id === "exp_reviewer"));
  assert.ok(catalog.users.some((item) => item.email === "admin"));

  const configured = await fetch(`${base}/v1/admin/experts/exp_reviewer`, {
    method: "POST",
    headers: { ...auth(admin.body.token!), "content-type": "application/json" },
    body: JSON.stringify({ name: "审查加强", enabled: true }),
  });
  assert.equal(configured.status, 200);

  const published = await fetch(`${base}/v1/admin/experts/exp_reviewer/publish`, {
    method: "POST",
    headers: { ...auth(admin.body.token!), "content-type": "application/json" },
    body: JSON.stringify({ audience: "allowlist", userIds: [admin.body.user?.id] }),
  });
  assert.equal(published.status, 200);

  const { listExpertsForActor } = await import("../../control-plane/src/experts/store.js");
  const { resetBundledExpertPolicyForTests } = await import("../../control-plane/src/experts/policy.js");
  try {
    assert.equal(listExpertsForActor({ userId: admin.body.user?.id }).some((item) => item.id === "exp_reviewer" && item.name === "审查加强"), true);
    assert.equal(listExpertsForActor({ userId: mateUser.id }).some((item) => item.id === "exp_reviewer"), false);
  } finally {
    resetBundledExpertPolicyForTests();
  }
});
