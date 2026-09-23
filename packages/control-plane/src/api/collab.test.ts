import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Project, Run, TranscriptMessage } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "collab-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-collab-"));
process.env.ACCOUNTS_REQUIRED = "1";
process.env.RATE_LIMIT = "0";
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

type Session = { token: string; user: { id: string; email: string } };

async function login(base: string, email: string, password: string): Promise<Session> {
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

function call(base: string, session: Session, route: string, method = "GET", body?: unknown): Promise<Response> {
  return fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("collaboration: invite links, host-only actions, attribution, transfer email", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");

  const project = (await (await call(base, admin, "/v1/projects", "POST", { name: "协作" })).json()) as Project;
  assert.equal(project.invitePolicy, "approve");

  const invite = (await (await call(base, admin, `/v1/projects/${project.id}/invites`, "POST", {})).json()) as { token: string };
  await createTeammateAccount({ email: "joiner", password: "654321", orgId: "org_local" });
  await createTeammateAccount({ email: "stranger", password: "654321", orgId: "org_local" });
  const joiner = await login(base, "joiner", "654321");
  const stranger = await login(base, "stranger", "654321");

  const first = await call(base, joiner, `/v1/invites/${invite.token}`, "POST", {});
  assert.equal(first.status, 200);
  const again = await call(base, joiner, `/v1/invites/${invite.token}`, "POST", {});
  assert.equal(again.status, 200);
  const stillPending = (await again.json()) as Project;
  assert.equal(stillPending.members.some((item) => item.userId === joiner.user.id), false, "asking twice must not skip approval");
  const hijack = await call(base, stranger, `/v1/invites/${invite.token}`, "POST", {});
  assert.equal(hijack.status, 400);

  const approved = await call(base, admin, `/v1/projects/${project.id}/invites/${invite.token}/approve`, "POST");
  assert.equal(approved.status, 200);
  assert.equal(((await approved.json()) as Project).members.some((item) => item.userId === joiner.user.id), true);
  const reuse = await call(base, stranger, `/v1/invites/${invite.token}`, "POST", {});
  assert.equal(reuse.status, 400);
  const peek = await call(base, stranger, `/v1/projects/${project.id}`);
  assert.equal(peek.status, 404);

  const addMate = await call(base, admin, `/v1/projects/${project.id}/members`, "POST", { email: "mate", password: "654321" });
  assert.equal(addMate.status, 200);
  const mate = await login(base, "mate", "654321");

  const created = await call(base, admin, "/v1/runs", "POST", {
    prompt: "房主的对话",
    repoUrls: ["fixtures/toy-repo"],
    projectId: project.id,
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as Run;

  const transcript = (await (await call(base, admin, `/v1/runs/${run.id}/transcript`)).json()) as {
    snapshot?: { messages?: TranscriptMessage[] };
  };
  const opener = transcript.snapshot?.messages?.find((item) => item.role === "user");
  assert.equal(opener?.actorUserId, admin.user.id);
  assert.equal(opener?.actorEmail, "admin");

  const invited = await call(base, admin, `/v1/runs/${run.id}/collaborators`, "POST", { userId: mate.user.id });
  assert.equal(invited.status, 200);

  const rename = await call(base, mate, `/v1/runs/${run.id}`, "PATCH", { title: "协作者改的名" });
  assert.equal(rename.status, 403);
  const archive = await call(base, mate, `/v1/runs/${run.id}/archive`, "POST");
  assert.equal(archive.status, 403);
  const remove = await call(base, mate, `/v1/runs/${run.id}`, "DELETE");
  assert.equal(remove.status, 403);
  const stop = await call(base, mate, `/v1/runs/${run.id}/abort`, "POST");
  assert.equal(stop.status, 200);
  const hostRename = await call(base, admin, `/v1/runs/${run.id}`, "PATCH", { title: "房主改的名" });
  assert.equal(hostRename.status, 200);
  const afterRename = (await (await call(base, admin, `/v1/runs/${run.id}`)).json()) as Run;
  assert.equal(afterRename.title, "房主改的名");

  const transferred = await call(base, admin, `/v1/runs/${run.id}/transfer`, "POST", { toUserId: joiner.user.id });
  assert.equal(transferred.status, 200);
  const next = (await transferred.json()) as Run;
  const host = next.collaborators?.find((item) => item.role === "host");
  assert.equal(host?.userId, joiner.user.id);
  assert.equal(host?.email, "joiner");
});
