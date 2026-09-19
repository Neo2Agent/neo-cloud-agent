import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createMate,
  createRunOk,
  jsonHeaders,
  login,
  readJson,
  startCoreApi,
} from "./helpers.js";

test("transcript: unauthenticated snapshot and SSE are 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const snap = await fetch(`${api.base}/v1/runs/${run.id}/transcript`);
  assert.equal(snap.status, 401);
  const events = await fetch(`${api.base}/v1/runs/${run.id}/events`);
  assert.equal(events.status, 401);
});

test("transcript: other user is 404", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const admin = await login(api.base);
  const mate = await createMate(api.base);
  const run = await createRunOk(api.base, admin.token);
  const snap = await fetch(`${api.base}/v1/runs/${run.id}/transcript`, { headers: jsonHeaders(mate.token) });
  assert.equal(snap.status, 404);
});

test("transcript: owner can read snapshot", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const snap = await fetch(`${api.base}/v1/runs/${run.id}/transcript?includeEvents=1`, { headers: jsonHeaders(token) });
  assert.equal(snap.status, 200);
  const body = await readJson<{ snapshot?: { messages?: unknown[] }; events?: unknown[] }>(snap);
  assert.ok(body.snapshot || Array.isArray(body.events));
});

test("workspace: fs unauthenticated is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const response = await fetch(`${api.base}/v1/runs/${run.id}/fs`);
  assert.equal(response.status, 401);
});

test("workspace: fs path escape is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const response = await fetch(`${api.base}/v1/runs/${run.id}/fs?path=${encodeURIComponent("../")}`, {
    headers: jsonHeaders(token),
  });
  assert.equal(response.status, 400);
  assert.match((await readJson<{ error?: string }>(response)).error ?? "", /escapes workspace/);
});

test("workspace: missing file is 404", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const response = await fetch(`${api.base}/v1/runs/${run.id}/fs?path=${encodeURIComponent("no-such-file.txt")}`, {
    headers: jsonHeaders(token),
  });
  assert.equal(response.status, 404);
  assert.match((await readJson<{ error?: string }>(response)).error ?? "", /not found/);
});

test("workspace: empty workspace lists as a directory", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token, { repoUrls: [] });
  const response = await fetch(`${api.base}/v1/runs/${run.id}/fs`, { headers: jsonHeaders(token) });
  assert.equal(response.status, 200);
  const body = await readJson<{ type?: string; entries?: unknown[] }>(response);
  assert.equal(body.type, "dir");
  assert.ok(Array.isArray(body.entries));
});

test("workspace: owner can read a file they wrote into the run dir", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token, { repoUrls: [] });
  const root = path.join(process.env.RUNS_DIR ?? "", run.id);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "note.txt"), "hello-core-e2e\n");
  const response = await fetch(`${api.base}/v1/runs/${run.id}/fs?path=note.txt&content=1`, {
    headers: jsonHeaders(token),
  });
  assert.equal(response.status, 200);
  const body = await readJson<{ content?: string; type?: string }>(response);
  assert.equal(body.type, "file");
  assert.match(body.content ?? "", /hello-core-e2e/);
});

test("workspace: fs isolation is 404", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const admin = await login(api.base);
  const mate = await createMate(api.base);
  const run = await createRunOk(api.base, admin.token);
  const response = await fetch(`${api.base}/v1/runs/${run.id}/fs`, { headers: jsonHeaders(mate.token) });
  assert.equal(response.status, 404);
});

test("workspace: diff without auth is 401; owner gets 200", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const denied = await fetch(`${api.base}/v1/runs/${run.id}/diff`);
  assert.equal(denied.status, 401);
  const ok = await fetch(`${api.base}/v1/runs/${run.id}/diff`, { headers: jsonHeaders(token) });
  assert.equal(ok.status, 200);
});

test("workspace: artifact upload requires name and content", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const missing = await fetch(`${api.base}/v1/runs/${run.id}/artifacts`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ name: "out.log" }),
  });
  assert.equal(missing.status, 400);
  assert.match((await readJson<{ error?: string }>(missing)).error ?? "", /name and content/);
});

test("workspace: artifact larger than 1.5MiB is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const response = await fetch(`${api.base}/v1/runs/${run.id}/artifacts`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ name: "huge.bin", content: "x".repeat(1_500_001) }),
  });
  assert.equal(response.status, 400);
  assert.match((await readJson<{ error?: string }>(response)).error ?? "", /too large/);
});

test("workspace: unsigned artifact download is 401; signed works", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  const uploaded = await fetch(`${api.base}/v1/runs/${run.id}/artifacts`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ name: "out.log", content: "artifact-ok\n", contentType: "text/plain" }),
  });
  assert.equal(uploaded.status, 201);

  const unsigned = await fetch(`${api.base}/v1/runs/${run.id}/artifacts/out.log`);
  assert.equal(unsigned.status, 401);

  const authed = await fetch(`${api.base}/v1/runs/${run.id}/artifacts/out.log`, { headers: jsonHeaders(token) });
  assert.equal(authed.status, 200);
  assert.equal(await authed.text(), "artifact-ok\n");

  const badSign = await fetch(`${api.base}/v1/runs/${run.id}/artifacts/out.log?token=nope`);
  assert.equal(badSign.status, 401);
});

test("workspace: save-to-project without a project is 400", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const run = await createRunOk(api.base, token);
  await fetch(`${api.base}/v1/runs/${run.id}/artifacts`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ name: "out.log", content: "x" }),
  });
  const response = await fetch(`${api.base}/v1/runs/${run.id}/artifacts/out.log/save-to-project`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: "{}",
  });
  assert.equal(response.status, 400);
  assert.match((await readJson<{ error?: string }>(response)).error ?? "", /项目对话/);
});
