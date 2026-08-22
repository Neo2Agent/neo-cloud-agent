import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Project } from "@neo-cloud-agent/contracts";
import type { Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "projects-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-projects-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;

const { createApiServer } = await import("./server.js");
const { createTeammateAccount, ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

const runsDir = process.env.RUNS_DIR;

async function login(base: string, email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { token?: string; user?: { id: string; email: string }; error?: string };
  assert.equal(response.status, 200, body.error ?? "login failed");
  assert.ok(body.token && body.user);
  return { token: body.token, user: body.user };
}

function auth(token: string): { "content-type": string; authorization: string } {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

test("projects share runs, inject instruction, and keep registration closed", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();

  const registered = await fetch(`${base}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "password1" }),
  });
  assert.equal(registered.status, 403);

  const admin = await login(base, "admin", "123456");
  assert.equal(admin.user.email, "admin");

  const created = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "官网改版", instruction: "用中文回复，先跑测试。" }),
  });
  assert.equal(created.status, 201);
  const project = (await created.json()) as Project;
  assert.equal(project.name, "官网改版");
  assert.equal(project.members[0]?.role, "owner");

  await assert.rejects(
    () => createTeammateAccount({ email: "admin", password: "654321", orgId: admin.user.id }),
    /账号不合法/,
  );
  const shortPassword = await fetch(`${base}/v1/projects/${project.id}/members`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ email: "newbie", password: "123" }),
  });
  assert.equal(shortPassword.status, 400);

  const added = await fetch(`${base}/v1/projects/${project.id}/members`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ email: "mate", password: "654321" }),
  });
  assert.equal(added.status, 200);
  const withMate = (await added.json()) as Project;
  assert.equal(withMate.members.length, 2);

  const mate = await login(base, "mate", "654321");
  const listed = await fetch(`${base}/v1/projects`, { headers: auth(mate.token) });
  assert.equal(listed.status, 200);
  const listBody = (await listed.json()) as { projects: Project[] };
  assert.equal(listBody.projects.length, 1);
  assert.equal(listBody.projects[0]?.id, project.id);

  const other = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "只有管理员看见" }),
  });
  assert.equal(other.status, 201);
  const otherProject = (await other.json()) as Project;
  const hidden = await fetch(`${base}/v1/projects/${otherProject.id}`, { headers: auth(mate.token) });
  assert.equal(hidden.status, 404);

  const runRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({
      prompt: "按项目规则改首页",
      repoUrls: ["fixtures/toy-repo"],
      projectId: project.id,
    }),
  });
  assert.equal(runRes.status, 201);
  const run = (await runRes.json()) as Run;
  assert.equal(run.projectId, project.id);
  assert.equal(run.assigneeUserId, admin.user.id);

  const memory = path.join(runsDir, run.id, ".neo", "PROJECT.md");
  assert.equal(existsSync(memory), true);
  assert.match(readFileSync(memory, "utf8"), /用中文回复，先跑测试/);

  const mateRun = await fetch(`${base}/v1/runs/${run.id}`, { headers: auth(mate.token) });
  assert.equal(mateRun.status, 200);

  const transferred = await fetch(`${base}/v1/runs/${run.id}/transfer`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ toUserId: mate.user.id }),
  });
  assert.equal(transferred.status, 200);
  const next = (await transferred.json()) as Run;
  assert.equal(next.userId, mate.user.id);
  assert.equal(next.assigneeUserId, mate.user.id);

  const after = await fetch(`${base}/v1/runs/${run.id}`, { headers: auth(mate.token) });
  assert.equal(after.status, 200);

  const health = (await (await fetch(`${base}/health`)).json()) as { projects?: number };
  assert.equal(health.projects, 2);
});
