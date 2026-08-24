import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { InboxItem, Project, ProjectMessage } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "inbox-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-inbox-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { createTeammateAccount, ensureDefaultAdmin } = await import("../accounts/accounts.js");
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

test("project messages are one-level and mentions write inbox", async (t) => {
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
      body: JSON.stringify({ name: "留言项目" }),
    })
  ).json()) as Project;
  await fetch(`${base}/v1/projects/${project.id}/members`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ email: "ping", password: "654321" }),
  });
  const mate = await login(base, "ping", "654321");

  const missingAt = await fetch(`${base}/v1/projects/${project.id}/messages`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ body: "没有名字", mentionUserIds: [mate.user.id] }),
  });
  assert.equal(missingAt.status, 400);

  const posted = await fetch(`${base}/v1/projects/${project.id}/messages`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ body: `@ping 看一下`, mentionUserIds: [mate.user.id] }),
  });
  assert.equal(posted.status, 201);
  const top = (await posted.json()) as ProjectMessage;

  const reply = await fetch(`${base}/v1/projects/${project.id}/messages`, {
    method: "POST",
    headers: auth(mate.token),
    body: JSON.stringify({ body: "收到", parentId: top.id }),
  });
  assert.equal(reply.status, 201);
  const nested = await fetch(`${base}/v1/projects/${project.id}/messages`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ body: "不能再回", parentId: ((await reply.json()) as ProjectMessage).id }),
  });
  assert.equal(nested.status, 400);

  const inbox = await fetch(`${base}/v1/inbox`, { headers: auth(mate.token) });
  assert.equal(inbox.status, 200);
  const items = ((await inbox.json()) as { items: InboxItem[] }).items;
  assert.equal(items.some((item) => item.kind === "mention"), true);
  assert.equal(items.some((item) => item.kind === "invited"), true);

  const assigned = await fetch(`${base}/v1/projects/${project.id}/todos`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ title: "改文案", assigneeUserIds: [mate.user.id] }),
  });
  assert.equal(assigned.status, 201);
  const afterTodo = await fetch(`${base}/v1/inbox`, { headers: auth(mate.token) });
  assert.equal(((await afterTodo.json()) as { items: InboxItem[] }).items.some((item) => item.kind === "todo_assigned"), true);

  await fetch(`${base}/v1/projects/${project.id}/members`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ email: "out", password: "654321" }),
  });
  const outsider = await login(base, "out", "654321");
  const hiddenProject = (await (
    await fetch(`${base}/v1/projects`, {
      method: "POST",
      headers: auth(admin.token),
      body: JSON.stringify({ name: "别人的项目" }),
    })
  ).json()) as Project;
  const hidden = await fetch(`${base}/v1/projects/${hiddenProject.id}/messages`, { headers: auth(outsider.token) });
  assert.equal(hidden.status, 404);

  await fetch(`${base}/v1/projects/${project.id}/messages/${top.id}`, {
    method: "DELETE",
    headers: auth(admin.token),
  });
  const left = await fetch(`${base}/v1/projects/${project.id}/messages`, { headers: auth(mate.token) });
  assert.equal(((await left.json()) as { messages: ProjectMessage[] }).messages.length, 0);
});

test("approve-policy invite writes invite_pending to admin inbox", async (t) => {
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
      body: JSON.stringify({ name: "审批项目" }),
    })
  ).json()) as Project;
  const inviteRes = await fetch(`${base}/v1/projects/${project.id}/invites`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({}),
  });
  const invite = (await inviteRes.json()) as { token: string };
  await createTeammateAccount({ email: "seeker", password: "654321", orgId: "org_local" });
  const seeker = await login(base, "seeker", "654321");
  const requested = await fetch(`${base}/v1/invites/${invite.token}`, {
    method: "POST",
    headers: auth(seeker.token),
    body: JSON.stringify({}),
  });
  assert.equal(requested.status, 200);
  const adminInbox = await fetch(`${base}/v1/inbox`, { headers: auth(admin.token) });
  const items = ((await adminInbox.json()) as { items: InboxItem[] }).items;
  assert.equal(items.some((item) => item.kind === "invite_pending" && item.projectId === project.id), true);
});
