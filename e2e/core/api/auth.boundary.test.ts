import assert from "node:assert/strict";
import test from "node:test";
import {
  jsonHeaders,
  login,
  readJson,
  startCoreApi,
  uniquePhone,
  uniqueUsername,
} from "./helpers.js";

test("auth: GET /health is public and reports accountsRequired", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/health`);
  assert.equal(response.status, 200);
  const health = await readJson<{ ok?: boolean; accountsRequired?: boolean; authRequired?: boolean }>(response);
  assert.equal(health.ok, true);
  assert.equal(health.accountsRequired, true);
});

test("auth: empty login is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email: "", password: "" }),
  });
  assert.equal(response.status, 401);
  assert.equal((await readJson<{ error?: string }>(response)).error, "invalid account or password");
});

test("auth: wrong password is 401 with the same opaque error", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email: "admin", password: "wrong-password" }),
  });
  assert.equal(response.status, 401);
  assert.equal((await readJson<{ error?: string }>(response)).error, "invalid account or password");
});

test("auth: unknown account is 401, not 404", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email: "nobody-here", password: "password1" }),
  });
  assert.equal(response.status, 401);
  assert.equal((await readJson<{ error?: string }>(response)).error, "invalid account or password");
});

test("auth: bootstrap endpoint stays closed", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/auth/bootstrap`, { method: "POST" });
  assert.equal(response.status, 403);
  assert.match((await readJson<{ error?: string }>(response)).error ?? "", /账号登录/);
});

test("auth: happy path admin session can call /v1/me", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const session = await login(api.base);
  assert.match(session.token, /^neo_sess_/);
  const me = await fetch(`${api.base}/v1/me`, { headers: jsonHeaders(session.token) });
  assert.equal(me.status, 200);
  assert.equal((await readJson<{ user?: { email?: string } }>(me)).user?.email, "admin");
});

test("auth: missing bearer on /v1/runs is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/runs`);
  assert.equal(response.status, 401);
  assert.equal((await readJson<{ error?: string }>(response)).error, "unauthorized");
});

test("auth: garbage bearer is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/runs`, { headers: jsonHeaders("neo_sess_not-a-real-session") });
  assert.equal(response.status, 401);
});

test("auth: logout invalidates the session token", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const session = await login(api.base);
  const loggedOut = await fetch(`${api.base}/v1/auth/logout`, {
    method: "POST",
    headers: jsonHeaders(session.token),
  });
  assert.equal(loggedOut.status, 200);
  const again = await fetch(`${api.base}/v1/me`, { headers: jsonHeaders(session.token) });
  assert.equal(again.status, 401);
});

test("auth: register without phone is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: uniqueUsername(), password: "password1" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await readJson<{ error?: string }>(response)).error, "请填写有效的手机号");
});

test("auth: register invalid username is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: "1bad", phone: uniquePhone(), password: "password1" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await readJson<{ error?: string }>(response)).error, "用户名不合法");
});

test("auth: register password shorter than 6 is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: uniqueUsername(), phone: uniquePhone(), password: "12345" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await readJson<{ error?: string }>(response)).error, "密码至少 6 位");
});

test("auth: register pending cannot login until approved", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const username = uniqueUsername();
  const phone = uniquePhone();
  const registered = await fetch(`${api.base}/v1/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username, phone, password: "password1" }),
  });
  assert.equal(registered.status, 201);
  const created = await readJson<{ pending?: boolean; token?: string; user?: { id: string } }>(registered);
  assert.equal(created.pending, true);
  assert.equal(created.token, undefined);

  const pendingLogin = await fetch(`${api.base}/v1/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email: phone, password: "password1" }),
  });
  assert.equal(pendingLogin.status, 403);
  assert.equal((await readJson<{ error?: string }>(pendingLogin)).error, "账号待管理员审核");

  const { approveAccount } = await import("../../../packages/control-plane/src/accounts/accounts.js");
  await approveAccount(created.user!.id);
  const ok = await fetch(`${api.base}/v1/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email: username, password: "password1" }),
  });
  assert.equal(ok.status, 200);
});

test("auth: duplicate phone is 409", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const phone = uniquePhone();
  const first = await fetch(`${api.base}/v1/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: uniqueUsername(), phone, password: "password1" }),
  });
  assert.equal(first.status, 201);
  const second = await fetch(`${api.base}/v1/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ username: uniqueUsername(), phone, password: "password1" }),
  });
  assert.equal(second.status, 409);
  assert.equal((await readJson<{ error?: string }>(second)).error, "手机号已注册");
});
