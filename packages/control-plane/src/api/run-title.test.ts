import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "run-title-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-run-title-"));
process.env.CONTROL_PLANE_TOKEN = "run-title-token";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { setSuggestFetchForTests } = await import("../title/suggest.js");
const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");

function auth() {
  return { "content-type": "application/json", authorization: "Bearer run-title-token" };
}

test("PATCH /v1/runs/:id renames, clears, generates, and rejects an empty body", async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  setSuggestFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: "登录页改版" } }] }), { status: 200 });
  });
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    setSuggestFetchForTests(null);
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;

  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ prompt: "把登录页做成深色", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as Run;
  assert.equal(run.title, "把登录页做成深色");

  const empty = await fetch(`${base}/v1/runs/${run.id}`, {
    method: "PATCH",
    headers: auth(),
    body: JSON.stringify({}),
  });
  assert.equal(empty.status, 400);

  const renamed = await fetch(`${base}/v1/runs/${run.id}`, {
    method: "PATCH",
    headers: auth(),
    body: JSON.stringify({ title: "  深色登录  " }),
  });
  assert.equal(renamed.status, 200);
  assert.equal(((await renamed.json()) as Run).title, "深色登录");

  const cleared = await fetch(`${base}/v1/runs/${run.id}`, {
    method: "PATCH",
    headers: auth(),
    body: JSON.stringify({ title: null }),
  });
  assert.equal(cleared.status, 200);
  assert.equal(((await cleared.json()) as Run).title, null);

  const generated = await fetch(`${base}/v1/runs/${run.id}`, {
    method: "PATCH",
    headers: auth(),
    body: JSON.stringify({ generate: true }),
  });
  assert.equal(generated.status, 200);
  assert.equal(((await generated.json()) as Run).title, "登录页改版");
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.url ?? "", /\/v1\/chat\/completions$/);
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.match(headers.authorization ?? "", /^Bearer /);

  const loaded = await fetch(`${base}/v1/runs/${run.id}`, { headers: auth() });
  assert.equal(((await loaded.json()) as Run).title, "登录页改版");
});

test("PATCH generate returns 502 when the gateway fails and keeps the title", async (t) => {
  setSuggestFetchForTests(async () => new Response("nope", { status: 503 }));
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    setSuggestFetchForTests(null);
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ prompt: "保留原标题", repoUrls: ["fixtures/toy-repo"] }),
  });
  const run = (await created.json()) as Run;
  const failed = await fetch(`${base}/v1/runs/${run.id}`, {
    method: "PATCH",
    headers: auth(),
    body: JSON.stringify({ generate: true }),
  });
  assert.equal(failed.status, 502);
  const loaded = await fetch(`${base}/v1/runs/${run.id}`, { headers: auth() });
  assert.equal(((await loaded.json()) as Run).title, "保留原标题");
});
