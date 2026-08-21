import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "accounts-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-accounts-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");

test("users register, login, and cannot see another user's run", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    delete process.env.ACCOUNTS_REQUIRED;
  });
  const base = `http://127.0.0.1:${port}`;

  const denied = await fetch(`${base}/v1/runs`);
  assert.equal(denied.status, 401);

  const registered = await fetch(`${base}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "password1" }),
  });
  assert.equal(registered.status, 201);
  const ada = (await registered.json()) as { token: string; user: { email: string } };
  assert.equal(ada.user.email, "ada@example.com");
  assert.match(ada.token, /^neo_sess_/);
  assert.match(registered.headers.get("set-cookie") ?? "", /neo_session=/);

  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ada.token}` },
    body: JSON.stringify({ prompt: "ada only", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as { id: string; userId: string };
  assert.ok(run.id);

  const other = await fetch(`${base}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "grace@example.com", password: "password1" }),
  });
  const grace = (await other.json()) as { token: string };
  const hidden = await fetch(`${base}/v1/runs/${run.id}`, {
    headers: { authorization: `Bearer ${grace.token}` },
  });
  assert.equal(hidden.status, 404);
  const listed = await fetch(`${base}/v1/runs`, {
    headers: { authorization: `Bearer ${grace.token}` },
  });
  const body = (await listed.json()) as { runs: Array<{ id: string }> };
  assert.equal(body.runs.some((item) => item.id === run.id), false);

  const login = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "password1" }),
  });
  assert.equal(login.status, 200);
  const adaAgain = (await login.json()) as { token: string };
  const visible = await fetch(`${base}/v1/runs/${run.id}`, {
    headers: { authorization: `Bearer ${adaAgain.token}` },
  });
  assert.equal(visible.status, 200);
  const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${adaAgain.token}` } });
  assert.equal(((await me.json()) as { user: { email: string } }).user.email, "ada@example.com");
});
