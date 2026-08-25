import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "admin-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-admin-"));
process.env.ACCOUNTS_REQUIRED = "1";
process.env.CONTROL_PLANE_TOKEN = "admin-api-token";
process.env.NEW_API_URL = "http://127.0.0.1:3000";
process.env.NEW_API_CONSOLE_URL = "http://127.0.0.1:3000";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;
delete process.env.ADMIN_EMAILS;

const { createApiServer } = await import("./server.js");
const { createTeammateAccount, ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

const SERVICE = { authorization: "Bearer admin-api-token" };

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as {
    token?: string;
    user?: { id: string; email: string; orgId: string };
    admin?: boolean;
    error?: string;
  };
  assert.equal(response.status, 200, body.error ?? "login failed");
  assert.ok(body.token && body.user);
  return { token: body.token, user: body.user, admin: Boolean(body.admin) };
}

function auth(token: string) {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

test("admin APIs are gated and return user / run / New API snapshots", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();

  const denied = await fetch(`${base}/v1/admin/overview`);
  assert.equal(denied.status, 401);

  const admin = await login(base, "admin", "123456");
  assert.equal(admin.admin, true);
  const mateUser = await createTeammateAccount({
    email: "mate",
    password: "654321",
    orgId: admin.user.orgId,
  });
  const mate = await login(base, "mate", "654321");
  assert.equal(mate.admin, false);

  const mateMe = await fetch(`${base}/v1/me`, { headers: auth(mate.token) });
  assert.equal(((await mateMe.json()) as { admin?: boolean }).admin, false);
  const adminMe = await fetch(`${base}/v1/me`, { headers: auth(admin.token) });
  assert.equal(((await adminMe.json()) as { admin?: boolean; actor?: string }).admin, true);

  const forbidden = await fetch(`${base}/v1/admin/users`, { headers: auth(mate.token) });
  assert.equal(forbidden.status, 403);
  assert.equal(((await forbidden.json()) as { error?: string }).error, "admin_required");

  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(mate.token),
    body: JSON.stringify({ prompt: "mate run", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(created.status, 201);
  const mateRun = (await created.json()) as Run;

  const overview = await fetch(`${base}/v1/admin/overview`, { headers: auth(admin.token) });
  assert.equal(overview.status, 200);
  const overviewBody = (await overview.json()) as {
    users: { total: number; admins: number };
    runs: { total: number };
    newApi: { url: string | null; consoleUrl: string | null };
    rateLimit: { store: string };
    llm: { upstream?: string };
  };
  assert.ok(overviewBody.users.total >= 2);
  assert.ok(overviewBody.users.admins >= 1);
  assert.ok(overviewBody.runs.total >= 1);
  assert.equal(overviewBody.newApi.consoleUrl, "http://127.0.0.1:3000");
  assert.equal(overviewBody.rateLimit.store, "memory");

  const users = await fetch(`${base}/v1/admin/users`, { headers: auth(admin.token) });
  assert.equal(users.status, 200);
  const usersBody = (await users.json()) as { users: Array<{ email: string; runCount: number; admin: boolean }> };
  const raw = JSON.stringify(usersBody);
  assert.equal(raw.includes("passwordHash") || raw.includes("password_hash"), false);
  assert.equal(usersBody.users.some((row) => row.email === "mate" && row.runCount >= 1), true);
  assert.equal(usersBody.users.some((row) => row.email === "admin" && row.admin), true);
  assert.equal(usersBody.users.some((row) => row.email === mateUser.email && row.admin), false);

  const runs = await fetch(`${base}/v1/admin/runs`, { headers: auth(admin.token) });
  assert.equal(runs.status, 200);
  const runsBody = (await runs.json()) as { runs: Array<{ id: string; prompt: string }>; total: number };
  assert.equal(runsBody.runs.some((row) => row.id === mateRun.id && row.prompt === "mate run"), true);

  const opened = await fetch(`${base}/v1/runs/${mateRun.id}`, { headers: auth(admin.token) });
  assert.equal(opened.status, 200);

  const service = await fetch(`${base}/v1/admin/overview`, { headers: SERVICE });
  assert.equal(service.status, 200);

  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "mate";
  try {
    const promoted = await fetch(`${base}/v1/admin/overview`, { headers: auth(mate.token) });
    assert.equal(promoted.status, 200);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});
