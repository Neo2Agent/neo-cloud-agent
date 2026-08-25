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
  assert.equal(project.invitePolicy, "approve");
  assert.equal(project.members[0]?.role, "owner");

  const openCreated = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "公开加入", invitePolicy: "open" }),
  });
  assert.equal(openCreated.status, 201);
  assert.equal(((await openCreated.json()) as Project).invitePolicy, "open");

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

  const mateHidden = await fetch(`${base}/v1/runs/${run.id}`, { headers: auth(mate.token) });
  assert.equal(mateHidden.status, 404);
  const mateList = await fetch(`${base}/v1/runs`, { headers: auth(mate.token) });
  assert.equal(mateList.status, 200);
  const mateRuns = (await mateList.json()) as { runs: Run[] };
  assert.equal(mateRuns.runs.some((item) => item.id === run.id), false);

  const patched = await fetch(`${base}/v1/projects/${project.id}`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ instruction: "用中文回复，先跑测试。保存后给同事看。" }),
  });
  assert.equal(patched.status, 200);
  const afterPatch = (await patched.json()) as Project;
  assert.match(afterPatch.instruction, /保存后给同事看/);

  const inviteRes = await fetch(`${base}/v1/projects/${project.id}/invites`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({}),
  });
  assert.equal(inviteRes.status, 201);
  const invite = (await inviteRes.json()) as { token: string };
  assert.ok(invite.token);
  await createTeammateAccount({ email: "joiner", password: "654321", orgId: "org_local" });
  const joiner = await login(base, "joiner", "654321");
  const requested = await fetch(`${base}/v1/invites/${invite.token}`, {
    method: "POST",
    headers: auth(joiner.token),
    body: JSON.stringify({}),
  });
  assert.equal(requested.status, 200);
  assert.equal(((await requested.json()) as Project).members.some((item) => item.email === "joiner"), false);
  const approved = await fetch(`${base}/v1/projects/${project.id}/invites/${invite.token}/approve`, {
    method: "POST",
    headers: auth(admin.token),
  });
  assert.equal(approved.status, 200);
  const otherProjectPeek = await fetch(`${base}/v1/projects/${otherProject.id}`, { headers: auth(joiner.token) });
  assert.equal(otherProjectPeek.status, 404);

  const mateOwn = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(mate.token),
    body: JSON.stringify({
      prompt: "同事自己开的对话",
      repoUrls: ["fixtures/toy-repo"],
      projectId: project.id,
    }),
  });
  assert.equal(mateOwn.status, 201);
  const mateRun = (await mateOwn.json()) as Run;
  assert.equal(mateRun.projectId, project.id);
  assert.equal(mateRun.assigneeUserId, mate.user.id);
  const mateSeesOwn = await fetch(`${base}/v1/runs/${mateRun.id}`, { headers: auth(mate.token) });
  assert.equal(mateSeesOwn.status, 200);
  const adminHiddenMate = await fetch(`${base}/v1/runs/${mateRun.id}`, { headers: auth(admin.token) });
  assert.equal(adminHiddenMate.status, 404);

  const sameInstruction = await fetch(`${base}/v1/projects/${project.id}`, { headers: auth(mate.token) });
  assert.equal(sameInstruction.status, 200);
  assert.match(((await sameInstruction.json()) as Project).instruction, /保存后给同事看/);

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
  const adminStill = await fetch(`${base}/v1/runs/${run.id}`, { headers: auth(admin.token) });
  assert.equal(adminStill.status, 200);

  const health = (await (await fetch(`${base}/health`)).json()) as { projects?: number };
  assert.equal(health.projects, 3);
});
