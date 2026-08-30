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
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;

const { createApiServer } = await import("./server.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

test("phone registration and username/phone login", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    delete process.env.ACCOUNTS_REQUIRED;
  });
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();

  const denied = await fetch(`${base}/v1/runs`);
  assert.equal(denied.status, 401);

  const missingPhone = await fetch(`${base}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "password1" }),
  });
  assert.equal(missingPhone.status, 400);

  const registered = await fetch(`${base}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ada", phone: "13800138000", password: "password1" }),
  });
  assert.equal(registered.status, 201);
  const createdAccount = (await registered.json()) as { token: string; user: { email: string; phone: string | null } };
  assert.equal(createdAccount.user.email, "ada");
  assert.equal(createdAccount.user.phone, "13800138000");
  assert.match(createdAccount.token, /^neo_sess_/);

  const duplicatePhone = await fetch(`${base}/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ada2", phone: "13800138000", password: "password1" }),
  });
  assert.equal(duplicatePhone.status, 409);
  assert.equal(((await duplicatePhone.json()) as { error?: string }).error, "手机号已注册");

  const phoneLogin = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "13800138000", password: "password1" }),
  });
  assert.equal(phoneLogin.status, 200);
  assert.equal(((await phoneLogin.json()) as { user: { email: string } }).user.email, "ada");

  const usernameLogin = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Ada", password: "password1" }),
  });
  assert.equal(usernameLogin.status, 200);

  const bootstrap = await fetch(`${base}/v1/auth/bootstrap`, { method: "POST" });
  assert.equal(bootstrap.status, 403);

  const wrong = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin", password: "wrong" }),
  });
  assert.equal(wrong.status, 401);

  const other = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "password1" }),
  });
  assert.equal(other.status, 401);

  const login = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Admin", password: "123456" }),
  });
  assert.equal(login.status, 200);
  const session = (await login.json()) as { token: string; user: { email: string } };
  assert.equal(session.user.email, "admin");
  assert.match(session.token, /^neo_sess_/);
  assert.match(login.headers.get("set-cookie") ?? "", /neo_session=/);

  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ prompt: "admin only", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(created.status, 201);
  const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${session.token}` } });
  assert.equal(((await me.json()) as { user: { email: string } }).user.email, "admin");

  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const patched = await fetch(`${base}/v1/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ avatar: pixel, neoAvatar: pixel }),
  });
  assert.equal(patched.status, 200);
  const saved = (await patched.json()) as { user: { avatar: string | null; neoAvatar: string | null } };
  assert.equal(saved.user.avatar, pixel);
  assert.equal(saved.user.neoAvatar, pixel);

  const reread = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${session.token}` } });
  const again = (await reread.json()) as { user: { avatar: string | null; neoAvatar: string | null } };
  assert.equal(again.user.avatar, pixel);
  assert.equal(again.user.neoAvatar, pixel);

  const cleared = await fetch(`${base}/v1/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ avatar: null, neoAvatar: null }),
  });
  assert.equal(cleared.status, 200);
  const empty = (await cleared.json()) as { user: { avatar: string | null; neoAvatar: string | null } };
  assert.equal(empty.user.avatar, null);
  assert.equal(empty.user.neoAvatar, null);

  const health = (await (await fetch(`${base}/health`)).json()) as {
    bootstrapLogin: boolean;
    defaultAdmin: boolean;
    bootstrapEmail: string | null;
  };
  assert.equal(health.bootstrapLogin, false);
  assert.equal(health.defaultAdmin, true);
  assert.equal(health.bootstrapEmail, "admin");
});
