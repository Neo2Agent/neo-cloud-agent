import assert from "node:assert/strict";
import test from "node:test";
import {
  createMate,
  createRun,
  createRunOk,
  jsonHeaders,
  login,
  readJson,
  startCoreApi,
  TOY_REPO,
} from "./helpers.js";

test("runs: missing prompt is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await fetch(`${api.base}/v1/runs`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ repoUrls: [TOY_REPO] }),
  });
  assert.equal(response.status, 400);
  assert.equal((await readJson<{ error?: string }>(response)).error, "prompt is required");
});

test("runs: missing repoUrls and envId is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await fetch(`${api.base}/v1/runs`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ prompt: "no repos field" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await readJson<{ error?: string }>(response)).error, "prompt and repoUrls are required");
});

test("runs: empty repoUrls array is accepted", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await createRun(api.base, token, { repoUrls: [] });
  assert.equal(response.status, 201);
  assert.ok((await readJson<{ id?: string }>(response)).id);
});

test("runs: unauthenticated create is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/runs`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ prompt: "no auth", repoUrls: [] }),
  });
  assert.equal(response.status, 401);
});

test("runs: obj: image pointer is rejected", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await createRun(api.base, token, {
    images: [{ mediaType: "image/png", data: "obj:runs/other/inbox/x" }],
  });
  assert.equal(response.status, 400);
  assert.equal((await readJson<{ error?: string }>(response)).error, "invalid image payload");
});

test("runs: isolation hides another user's run as 404", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const admin = await login(api.base);
  const mate = await createMate(api.base);
  const run = await createRunOk(api.base, admin.token);

  const stolen = await fetch(`${api.base}/v1/runs/${run.id}`, { headers: jsonHeaders(mate.token) });
  assert.equal(stolen.status, 404);

  const listed = await readJson<{ runs: Array<{ id: string }> }>(
    await fetch(`${api.base}/v1/runs`, { headers: jsonHeaders(mate.token) }),
  );
  assert.equal(listed.runs.some((item) => item.id === run.id), false);

  const ownList = await readJson<{ runs: Array<{ id: string }> }>(
    await fetch(`${api.base}/v1/runs`, { headers: jsonHeaders(admin.token) }),
  );
  assert.equal(ownList.runs.some((item) => item.id === run.id), true);
});

test("runs: unknown id is 404", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await fetch(`${api.base}/v1/runs/run_does_not_exist`, { headers: jsonHeaders(token) });
  assert.equal(response.status, 404);
});

test("runs: follow-up without text is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const response = await fetch(`${api.base}/v1/runs/${run.id}/follow-ups`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  assert.equal((await readJson<{ error?: string }>(response)).error, "text is required");
});

test("runs: follow-up on archived run is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const archived = await fetch(`${api.base}/v1/runs/${run.id}/archive`, {
    method: "POST",
    headers: jsonHeaders(token),
  });
  assert.equal(archived.status, 200);
  const follow = await fetch(`${api.base}/v1/runs/${run.id}/follow-ups`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ text: "after archive" }),
  });
  assert.equal(follow.status, 400);
  assert.match((await readJson<{ error?: string }>(follow)).error ?? "", /archived/i);
});

test("runs: delete before archive is 409; after archive is 200", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const tooSoon = await fetch(`${api.base}/v1/runs/${run.id}`, { method: "DELETE", headers: jsonHeaders(token) });
  assert.equal(tooSoon.status, 409);

  const archived = await fetch(`${api.base}/v1/runs/${run.id}/archive`, {
    method: "POST",
    headers: jsonHeaders(token),
  });
  assert.equal(archived.status, 200);

  const deleted = await fetch(`${api.base}/v1/runs/${run.id}`, { method: "DELETE", headers: jsonHeaders(token) });
  assert.equal(deleted.status, 200);
  const missing = await fetch(`${api.base}/v1/runs/${run.id}`, { headers: jsonHeaders(token) });
  assert.equal(missing.status, 404);
});

test("runs: abort without auth is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const denied = await fetch(`${api.base}/v1/runs/${run.id}/abort`, { method: "POST" });
  assert.equal(denied.status, 401);
  const ok = await fetch(`${api.base}/v1/runs/${run.id}/abort`, { method: "POST", headers: jsonHeaders(token) });
  assert.equal(ok.status, 200);
});

test("runs: concurrent creates both succeed", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const [a, b] = await Promise.all([
    createRun(api.base, token, { prompt: "concurrent-a" }),
    createRun(api.base, token, { prompt: "concurrent-b" }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const idA = (await readJson<{ id: string }>(a)).id;
  const idB = (await readJson<{ id: string }>(b)).id;
  assert.notEqual(idA, idB);
});

test("runs: concurrent follow-ups both queue", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const [a, b] = await Promise.all([
    fetch(`${api.base}/v1/runs/${run.id}/follow-ups`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ text: "first" }),
    }),
    fetch(`${api.base}/v1/runs/${run.id}/follow-ups`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ text: "second" }),
    }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const listed = await fetch(`${api.base}/v1/runs/${run.id}/follow-ups`, { headers: jsonHeaders(token) });
  const body = await readJson<{ followUps: Array<{ text: string }> }>(listed);
  assert.ok(body.followUps.length >= 2);
});

test("runs: follow-up isolation is 404", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const admin = await login(api.base);
  const mate = await createMate(api.base);
  const run = await createRunOk(api.base, admin.token);
  const stolen = await fetch(`${api.base}/v1/runs/${run.id}/follow-ups`, {
    method: "POST",
    headers: jsonHeaders(mate.token),
    body: JSON.stringify({ text: "nope" }),
  });
  assert.equal(stolen.status, 404);
});

test("runs: unknown projectId is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await createRun(api.base, token, { projectId: "proj_missing" });
  assert.equal(response.status, 400);
  assert.match((await readJson<{ error?: string }>(response)).error ?? "", /项目不存在/);
});
