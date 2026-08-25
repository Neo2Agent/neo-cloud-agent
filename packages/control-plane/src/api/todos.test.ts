import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Project, ProjectTodo, Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "todos-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-todos-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await response.json()) as { token: string; user: { id: string; email: string } };
}

function auth(token: string) {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

test("project todos transition, nest one level, and bind runs", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => close(server));
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");
  const project = (await (
    await fetch(`${base}/v1/projects`, {
      method: "POST",
      headers: auth(admin.token),
      body: JSON.stringify({ name: "看板项目" }),
    })
  ).json()) as Project;

  const created = await fetch(`${base}/v1/projects/${project.id}/todos`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ title: "改首页", description: "先出稿" }),
  });
  assert.equal(created.status, 201);
  const todo = (await created.json()) as ProjectTodo;
  assert.equal(todo.status, "claim");

  const badPause = await fetch(`${base}/v1/projects/${project.id}/todos/${todo.id}/transition`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ status: "paused" }),
  });
  assert.equal(badPause.status, 400);

  const paused = await fetch(`${base}/v1/projects/${project.id}/todos/${todo.id}/transition`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ status: "paused", pauseReason: "等设计" }),
  });
  assert.equal(paused.status, 200);
  assert.equal(((await paused.json()) as ProjectTodo).status, "paused");

  const back = await fetch(`${base}/v1/projects/${project.id}/todos/${todo.id}/transition`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ status: "claim" }),
  });
  assert.equal(((await back.json()) as ProjectTodo).status, "claim");

  const child = await fetch(`${base}/v1/projects/${project.id}/todos`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ title: "子任务", parentTodoId: todo.id }),
  });
  assert.equal(child.status, 201);
  const childTodo = (await child.json()) as ProjectTodo;
  const grandchild = await fetch(`${base}/v1/projects/${project.id}/todos`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ title: "孙任务", parentTodoId: childTodo.id }),
  });
  assert.equal(grandchild.status, 400);

  const runRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ prompt: "做这张卡", repoUrls: ["fixtures/toy-repo"], projectId: project.id, todoId: todo.id }),
  });
  assert.equal(runRes.status, 201);
  const run = (await runRes.json()) as Run;
  assert.equal(run.todoId, todo.id);
  const bound = await fetch(`${base}/v1/projects/${project.id}/todos/${todo.id}`, { headers: auth(admin.token) });
  assert.equal(((await bound.json()) as ProjectTodo).runId, run.id);

  const handoff = await fetch(`${base}/v1/projects/${project.id}/todos`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ title: "从对话流转", runId: run.id, source: "handoff" }),
  });
  assert.equal(handoff.status, 201);
  assert.equal(((await handoff.json()) as ProjectTodo).source, "handoff");

  await fetch(`${base}/v1/projects/${project.id}/members`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ email: "outsider", password: "654321" }),
  });
  const other = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "别人的" }),
  });
  const otherProject = (await other.json()) as Project;
  const outsider = await login(base, "outsider", "654321");
  const hidden = await fetch(`${base}/v1/projects/${otherProject.id}/todos`, { headers: auth(outsider.token) });
  assert.equal(hidden.status, 404);
});
