import assert from "node:assert/strict";
import test from "node:test";
import { createMate, jsonHeaders, login, readJson, startCoreApi } from "./helpers.js";

test("catalog: experts without auth is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/experts`);
  assert.equal(response.status, 401);
});

test("catalog: logged-in user sees bundled experts", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await fetch(`${api.base}/v1/experts`, { headers: jsonHeaders(token) });
  assert.equal(response.status, 200);
  const body = await readJson<{ experts: Array<{ id: string; visibility?: string }> }>(response);
  assert.ok(body.experts.some((item) => item.id === "exp_reviewer"));
  assert.ok(body.experts.every((item) => item.visibility === "bundled"));
});

test("catalog: expert-teams and plugins require a session", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  assert.equal((await fetch(`${api.base}/v1/expert-teams`)).status, 401);
  assert.equal((await fetch(`${api.base}/v1/plugins`)).status, 401);
  const { token } = await login(api.base);
  const teams = await fetch(`${api.base}/v1/expert-teams`, { headers: jsonHeaders(token) });
  assert.equal(teams.status, 200);
  const plugins = await fetch(`${api.base}/v1/plugins`, { headers: jsonHeaders(token) });
  assert.equal(plugins.status, 200);
  assert.ok(Array.isArray((await readJson<{ plugins?: unknown[] }>(plugins)).plugins));
});

test("catalog: creating an expert without a user session is login_required", async (t) => {
  const previous = process.env.CONTROL_PLANE_TOKEN;
  process.env.CONTROL_PLANE_TOKEN = "core-e2e-service-token";
  t.after(() => {
    if (previous === undefined) delete process.env.CONTROL_PLANE_TOKEN;
    else process.env.CONTROL_PLANE_TOKEN = previous;
  });
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/experts`, {
    method: "POST",
    headers: jsonHeaders("core-e2e-service-token"),
    body: JSON.stringify({ name: "x", persona: "y" }),
  });
  assert.equal(response.status, 401);
  assert.equal((await readJson<{ error?: string }>(response)).error, "login_required");
});

test("catalog: empty expert create is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await fetch(`${api.base}/v1/experts`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
});

test("catalog: expert body over 8000 chars is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await fetch(`${api.base}/v1/experts`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      name: "too-long",
      description: "too long body",
      persona: "x".repeat(8001),
      methodology: "m",
      deliverables: "d",
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await readJson<{ error?: string }>(response)).error ?? "", /最多 8000/);
});

test("catalog: memories without Mem0 still list as unwired", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const listed = await fetch(`${api.base}/v1/memories`, { headers: jsonHeaders(token) });
  assert.equal(listed.status, 200);
  const body = await readJson<{ configured?: boolean; memories?: unknown[] }>(listed);
  assert.equal(body.configured, false);
  assert.deepEqual(body.memories, []);

  const added = await fetch(`${api.base}/v1/memories`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ text: "should not persist without mem0" }),
  });
  assert.ok([400, 502, 503].includes(added.status), `unexpected memories POST ${added.status}`);
  const err = await readJson<{ error?: string; code?: string }>(added);
  assert.match(err.error ?? "", /记忆还没接上|记忆服务暂时不可用|请填写记忆内容/);
});

test("catalog: memories without auth is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/memories`);
  assert.equal(response.status, 401);
});

test("catalog: one user cannot see another user's personal expert", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const admin = await login(api.base);
  const mate = await createMate(api.base);
  const created = await fetch(`${api.base}/v1/experts`, {
    method: "POST",
    headers: jsonHeaders(admin.token),
    body: JSON.stringify({
      name: "admin-only-expert",
      description: "private role",
      persona: "You are private.",
      methodology: "Read then answer.",
      deliverables: "## Notes",
    }),
  });
  assert.equal(created.status, 201);
  const mine = await readJson<{ id: string }>(created);
  const mateList = await readJson<{ experts: Array<{ id: string }> }>(
    await fetch(`${api.base}/v1/experts`, { headers: jsonHeaders(mate.token) }),
  );
  assert.equal(mateList.experts.some((item) => item.id === mine.id), false);
});
