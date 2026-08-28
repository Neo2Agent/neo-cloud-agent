import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { FollowUp, InboxItem, Project, Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "collab-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-collab-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;

const { createApiServer } = await import("./server.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

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

test("cloud project runs invite collaborators without a second worker", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");

  const created = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "协作项目", instruction: "一起改" }),
  });
  const project = (await created.json()) as Project;
  await fetch(`${base}/v1/projects/${project.id}/members`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ email: "mate", password: "654321" }),
  });
  const mate = await login(base, "mate", "654321");

  const runRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ prompt: "云端一起看", repoUrls: ["fixtures/toy-repo"], projectId: project.id }),
  });
  assert.equal(runRes.status, 201);
  const run = (await runRes.json()) as Run;
  assert.equal(run.collaborators?.[0]?.role, "host");
  assert.equal(run.collaborators?.[0]?.userId, admin.user.id);
  const workerHandle = run.workerHandle;
  const vmSlotId = run.vmSlotId;

  const hidden = await fetch(`${base}/v1/runs/${run.id}`, { headers: auth(mate.token) });
  assert.equal(hidden.status, 404);
  assert.equal((await fetch(`${base}/v1/runs/${run.id}/transcript`, { headers: auth(mate.token) })).status, 404);
  assert.equal((await fetch(`${base}/v1/runs/${run.id}/follow-ups`, { headers: auth(mate.token) })).status, 404);
  assert.equal((await fetch(`${base}/v1/runs/${run.id}/events`, { headers: auth(mate.token) })).status, 404);
  const listed = await fetch(`${base}/v1/runs`, { headers: auth(mate.token) });
  const listBody = (await listed.json()) as { runs: Run[] };
  assert.equal(listBody.runs.some((item) => item.id === run.id), false);
  const cards = await fetch(`${base}/v1/projects/${project.id}/runs`, { headers: auth(mate.token) });
  assert.equal(cards.status, 200);
  assert.equal(((await cards.json()) as { runs: Array<{ id: string }> }).runs.some((item) => item.id === run.id), false);

  const inbox = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ prompt: "无项目", repoUrls: ["fixtures/toy-repo"] }),
  });
  const inboxRun = (await inbox.json()) as Run;
  const inboxInvite = await fetch(`${base}/v1/runs/${inboxRun.id}/collaborators`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ userId: mate.user.id }),
  });
  assert.equal(inboxInvite.status, 400);

  const invited = await fetch(`${base}/v1/runs/${run.id}/collaborators`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ userId: mate.user.id }),
  });
  assert.equal(invited.status, 200);
  const after = (await invited.json()) as Run;
  assert.equal(after.id, run.id);
  assert.equal(after.workerHandle, workerHandle);
  assert.equal(after.vmSlotId, vmSlotId);
  assert.equal(after.collaborators?.some((item) => item.userId === mate.user.id && item.role === "editor"), true);

  const visible = await fetch(`${base}/v1/runs/${run.id}`, { headers: auth(mate.token) });
  assert.equal(visible.status, 200);
  assert.equal((await fetch(`${base}/v1/runs/${run.id}/transcript`, { headers: auth(mate.token) })).status, 200);
  const mateInbox = await fetch(`${base}/v1/inbox`, { headers: auth(mate.token) });
  assert.equal(
    ((await mateInbox.json()) as { items: InboxItem[] }).items.some((item) => item.kind === "invited" && item.runId === run.id),
    true,
  );
  const mateCards = await fetch(`${base}/v1/projects/${project.id}/runs`, { headers: auth(mate.token) });
  assert.equal(((await mateCards.json()) as { runs: Array<{ id: string }> }).runs.some((item) => item.id === run.id), true);

  const first = await fetch(`${base}/v1/runs/${run.id}/follow-ups`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ text: "房主还在说" }),
  });
  assert.equal(first.status, 201);
  const second = await fetch(`${base}/v1/runs/${run.id}/follow-ups`, {
    method: "POST",
    headers: auth(mate.token),
    body: JSON.stringify({ text: "同事排队" }),
  });
  assert.equal(second.status, 201);
  const queued = (await second.json()) as FollowUp;
  assert.equal(queued.status, "queued");
  assert.equal(queued.actorUserId, mate.user.id);
  const queue = await fetch(`${base}/v1/runs/${run.id}/follow-ups`, { headers: auth(mate.token) });
  const followUps = ((await queue.json()) as { followUps: FollowUp[] }).followUps;
  const actors = new Set(followUps.map((item) => item.actorUserId).filter(Boolean));
  assert.equal(followUps.filter((item) => item.status === "queued").length >= 1, true);
  assert.equal(actors.has(mate.user.id), true);
  assert.equal(followUps.some((item) => item.actorUserId === admin.user.id || item.actorUserId === mate.user.id), true);
  const transcript = await fetch(`${base}/v1/runs/${run.id}/transcript`, { headers: auth(mate.token) });
  assert.equal(transcript.status, 200);
  const snapshot = ((await transcript.json()) as { snapshot?: { messages?: Array<{ role: string; text: string }> } }).snapshot;
  assert.equal(snapshot?.messages?.some((item) => item.role === "user" && item.text === "同事排队"), false);

  const own = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(mate.token),
    body: JSON.stringify({ prompt: "同事自己的云端", repoUrls: ["fixtures/toy-repo"], projectId: project.id }),
  });
  const ownRun = (await own.json()) as Run;
  assert.equal((await fetch(`${base}/v1/runs/${ownRun.id}`, { headers: auth(mate.token) })).status, 200);
  assert.equal((await fetch(`${base}/v1/runs/${ownRun.id}`, { headers: auth(admin.token) })).status, 404);

  const reassigned = await fetch(`${base}/v1/runs/${run.id}/transfer`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ toUserId: mate.user.id, mode: "reassign" }),
  });
  assert.equal(reassigned.status, 200);
  const nextHost = (await reassigned.json()) as Run;
  assert.equal(nextHost.userId, mate.user.id);
  assert.equal(nextHost.collaborators?.some((item) => item.userId === admin.user.id), true);
  assert.equal((await fetch(`${base}/v1/runs/${run.id}`, { headers: auth(admin.token) })).status, 200);
  const handoff = await fetch(`${base}/v1/runs/${run.id}/artifacts`, { headers: auth(mate.token) });
  assert.equal(handoff.status, 200);
  assert.equal(
    ((await handoff.json()) as { artifacts: Array<{ name: string }> }).artifacts.some((item) => item.name === "HANDOFF.md"),
    true,
  );

  const forked = await fetch(`${base}/v1/runs/${ownRun.id}/transfer`, {
    method: "POST",
    headers: auth(mate.token),
    body: JSON.stringify({ toUserId: admin.user.id, mode: "fork" }),
  });
  assert.equal(forked.status, 200);
  const forkRun = (await forked.json()) as Run;
  assert.notEqual(forkRun.id, ownRun.id);
  assert.equal((await fetch(`${base}/v1/runs/${ownRun.id}`, { headers: auth(mate.token) })).status, 200);
});

test("desk project runs reject collaborator invites", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");
  const created = await fetch(`${base}/v1/projects`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "本机项目" }),
  });
  const project = (await created.json()) as Project;
  await fetch(`${base}/v1/projects/${project.id}/members`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ email: "deskmate", password: "654321" }),
  });
  const mate = await login(base, "deskmate", "654321");
  const desk = await fetch(`${base}/v1/desks`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ name: "admin-desk" }),
  });
  const deskBody = (await desk.json()) as { id?: string };
  const runRes = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({
      prompt: "本机对话",
      repoUrls: ["fixtures/toy-repo"],
      projectId: project.id,
      target: { loop: "desk", tools: "desk", deskId: deskBody.id },
    }),
  });
  const run = (await runRes.json()) as Run & { error?: string };
  if (runRes.status !== 201) {
    assert.ok(run.error);
    return;
  }
  const invited = await fetch(`${base}/v1/runs/${run.id}/collaborators`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({ userId: mate.user.id }),
  });
  assert.equal(invited.status, 400);
});
