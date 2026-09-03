import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "memories-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-memories-"));
process.env.ACCOUNTS_REQUIRED = "1";
process.env.CONTROL_PLANE_TOKEN = "memories-api-token";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.MEM0_URL;
delete process.env.MEM0_API_KEY;

const { createApiServer } = await import("./server.js");
const { setMem0FetchForTests } = await import("../memory/client.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");
const { mintRunToken } = await import("@neo-cloud-agent/contracts");
const { createRun } = await import("../orchestrator/orchestrator.js");

async function login(base: string): Promise<string> {
  await ensureDefaultAdmin();
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin", password: "123456" }),
  });
  const body = (await response.json()) as { token?: string };
  assert.ok(body.token);
  return body.token;
}

function withMem0Env(t: { after: (fn: () => void) => void }): void {
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  process.env.MEM0_URL = "http://mem0.test";
  process.env.MEM0_API_KEY = "m0sk_test";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
  });
}

test("GET /health reports mem0 without exposing the url", async (t) => {
  withMem0Env(t);
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
    mem0?: { configured?: boolean; url?: string };
  };
  assert.equal(health.mem0?.configured, true);
  assert.equal(health.mem0?.url, undefined);
  assert.deepEqual(Object.keys(health.mem0 ?? {}), ["configured"]);
});

test("/v1/memories add search list and delete go through Mem0", async (t) => {
  withMem0Env(t);
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    setMem0FetchForTests(null);
  });
  const base = `http://127.0.0.1:${port}`;
  const token = await login(base);
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const calls: Array<{ method?: string; url: string }> = [];
  setMem0FetchForTests(async (url, init) => {
    calls.push({ method: init?.method, url });
    if (url.endsWith("/search") || url.includes("/memories?")) {
      return new Response(JSON.stringify({ results: [{ id: "m1", memory: "用 pnpm" }] }), { status: 200 });
    }
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ results: [{ id: "m1", memory: "用 pnpm" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const added = await fetch(`${base}/v1/memories`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "用 pnpm" }),
  });
  assert.equal(added.status, 201);
  assert.equal(((await added.json()) as { memories: Array<{ text: string }> }).memories[0]?.text, "用 pnpm");

  const listed = await fetch(`${base}/v1/memories`, { headers });
  assert.equal(listed.status, 200);
  assert.equal(((await listed.json()) as { configured: boolean; memories: unknown[] }).configured, true);

  const found = await fetch(`${base}/v1/memories/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: "包管理器" }),
  });
  assert.equal(found.status, 200);
  assert.equal(((await found.json()) as { memories: Array<{ id: string }> }).memories[0]?.id, "m1");

  const deleted = await fetch(`${base}/v1/memories/m1`, { method: "DELETE", headers });
  assert.equal(deleted.status, 200);
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.includes("/memories/m1?user_id=")));
});

test("PATCH /v1/memories/:id goes out as PUT with the session user", async (t) => {
  withMem0Env(t);
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    setMem0FetchForTests(null);
  });
  const base = `http://127.0.0.1:${port}`;
  const token = await login(base);
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const calls: Array<{ method?: string; url: string; body?: unknown }> = [];
  setMem0FetchForTests(async (url, init) => {
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method: init?.method, url, body });
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "m1",
            memory: "改用 bun",
            user_id: "admin",
            created_at: "2026-09-01T00:00:00.000Z",
            updated_at: "2026-09-01T00:00:01.000Z",
          },
        ],
      }),
      { status: 200 },
    );
  });

  const patched = await fetch(`${base}/v1/memories/m1`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ text: "改用 bun", updatedAt: "2026-09-01T00:00:00.000Z" }),
  });
  assert.equal(patched.status, 200);
  const payload = (await patched.json()) as { memory?: { text?: string } };
  assert.equal(payload.memory?.text, "改用 bun");
  const put = calls.find((call) => call.method === "PUT");
  assert.ok(put?.url.endsWith("/memories/m1"));
  assert.equal((put?.body as { user_id?: string }).user_id, "admin");
  assert.equal((put?.body as { text?: string }).text, "改用 bun");
});

test("PATCH empty or too long text does not call Mem0", async (t) => {
  withMem0Env(t);
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    setMem0FetchForTests(null);
  });
  const base = `http://127.0.0.1:${port}`;
  const token = await login(base);
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const calls: Array<{ method?: string; url: string }> = [];
  setMem0FetchForTests(async (url, init) => {
    calls.push({ method: init?.method, url });
    return new Response("{}", { status: 200 });
  });

  const empty = await fetch(`${base}/v1/memories/m1`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ text: "   " }),
  });
  assert.equal(empty.status, 400);
  const emptyBody = (await empty.json()) as { code?: string; error?: string; message?: string };
  assert.equal(emptyBody.code, "MEMORY_TEXT_REQUIRED");
  assert.equal(emptyBody.error, "请填写记忆内容");

  const tooLong = await fetch(`${base}/v1/memories/m1`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ text: "字".repeat(501) }),
  });
  assert.equal(tooLong.status, 400);
  assert.equal(((await tooLong.json()) as { code?: string }).code, "MEMORY_TEXT_TOO_LONG");
  assert.equal(calls.length, 0);
});

test("PATCH without a session is 401", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const response = await fetch(`http://127.0.0.1:${port}/v1/memories/m1`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "改" }),
  });
  assert.equal(response.status, 401);
  const body = (await response.json()) as { code?: string; error?: string; message?: string };
  assert.equal(body.code, "MEMORY_LOGIN_REQUIRED");
  assert.equal(body.error, "请先登录");
  assert.equal(body.message, "请先登录");
});

test("PATCH sidecar 404 and 409 map to the Chinese envelope", async (t) => {
  withMem0Env(t);
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    setMem0FetchForTests(null);
  });
  const base = `http://127.0.0.1:${port}`;
  const token = await login(base);
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  setMem0FetchForTests(async () => new Response(JSON.stringify({ detail: "memory_not_found" }), { status: 404 }));
  const missing = await fetch(`${base}/v1/memories/m1`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ text: "改" }),
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: "记忆不存在",
    code: "MEMORY_NOT_FOUND",
    message: "记忆不存在",
  });

  setMem0FetchForTests(async () => new Response(JSON.stringify({ detail: "version_conflict" }), { status: 409 }));
  const conflict = await fetch(`${base}/v1/memories/m1`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ text: "改", updatedAt: "2026-09-01T00:00:00.000Z" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(((await conflict.json()) as { code?: string }).code, "MEMORY_VERSION_CONFLICT");
});

test("GET ?limit=abc and search limit 33 are normalized", async (t) => {
  withMem0Env(t);
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    setMem0FetchForTests(null);
  });
  const base = `http://127.0.0.1:${port}`;
  const token = await login(base);
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const calls: Array<{ method?: string; url: string; body?: unknown }> = [];
  setMem0FetchForTests(async (url, init) => {
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method: init?.method, url, body });
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  });

  const listed = await fetch(`${base}/v1/memories?limit=abc`, { headers });
  assert.equal(listed.status, 200);
  const listCall = calls.find((call) => call.url.includes("/memories?"));
  assert.match(listCall?.url ?? "", /limit=50/);
  assert.doesNotMatch(listCall?.url ?? "", /NaN/);

  const found = await fetch(`${base}/v1/memories/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: "包管理器", limit: 33 }),
  });
  assert.equal(found.status, 200);
  const searchCall = calls.find((call) => call.url.endsWith("/search"));
  assert.equal((searchCall?.body as { limit?: number }).limit, 32);
});

test("DELETE /v1/memories/search is not treated as a memory id", async (t) => {
  withMem0Env(t);
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    setMem0FetchForTests(null);
  });
  const base = `http://127.0.0.1:${port}`;
  const token = await login(base);
  const calls: Array<{ method?: string; url: string }> = [];
  setMem0FetchForTests(async (url, init) => {
    calls.push({ method: init?.method, url });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const response = await fetch(`${base}/v1/memories/search`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.notEqual(response.status, 200);
  assert.equal(
    calls.some((call) => call.method === "DELETE"),
    false,
  );
});

test("worker JWT can add and search memories for the run user", async (t) => {
  withMem0Env(t);
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    setMem0FetchForTests(null);
  });
  const base = `http://127.0.0.1:${port}`;
  const mem0Calls: Array<{ method?: string; url: string; body?: unknown }> = [];
  setMem0FetchForTests(async (url, init) => {
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    mem0Calls.push({ method: init?.method, url, body });
    return new Response(JSON.stringify({ results: [{ id: "m1", memory: "用 pnpm" }] }), { status: 200 });
  });
  const run = await createRun({ prompt: "记住包管理器", repoUrls: ["fixtures/toy-repo"] });
  const jwt = mintRunToken("memories-secret", {
    sub: "worker",
    runId: run.id,
    orgId: "org_local",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "memories-internal",
  });

  const denied = await fetch(`${base}/internal/runs/${run.id}/memories`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "add", text: "用 pnpm" }),
  });
  assert.equal(denied.status, 401);

  const added = await fetch(`${base}/internal/runs/${run.id}/memories`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "add", text: "用 pnpm", userId: "someone-else" }),
  });
  assert.equal(added.status, 201);
  assert.equal(((await added.json()) as { memories: Array<{ text: string }> }).memories[0]?.text, "用 pnpm");
  const addCall = mem0Calls.find((call) => call.method === "POST" && call.url.endsWith("/memories"));
  assert.equal((addCall?.body as { user_id?: string })?.user_id, run.userId);
  assert.equal((addCall?.body as { infer?: boolean })?.infer, false);
  assert.equal((addCall?.body as { metadata?: { source?: string } })?.metadata?.source, "agent");

  const found = await fetch(`${base}/internal/runs/${run.id}/memories`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "search", query: "包管理器" }),
  });
  assert.equal(found.status, 200);
  assert.equal(((await found.json()) as { memories: Array<{ id: string }> }).memories[0]?.id, "m1");
  const searchCall = mem0Calls.find((call) => call.url.endsWith("/search"));
  assert.equal((searchCall?.body as { user_id?: string })?.user_id, run.userId);
});

test("internal memories require Mem0", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const run = await createRun({ prompt: "no mem0", repoUrls: ["fixtures/toy-repo"] });
  const jwt = mintRunToken("memories-secret", {
    sub: "worker",
    runId: run.id,
    orgId: "org_local",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "memories-unconfigured",
  });
  const response = await fetch(`http://127.0.0.1:${port}/internal/runs/${run.id}/memories`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "add", text: "用 pnpm" }),
  });
  assert.equal(response.status, 503);
});

test("POST /v1/memories requires a session", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const response = await fetch(`http://127.0.0.1:${port}/v1/memories`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "用 pnpm" }),
  });
  assert.equal(response.status, 401);
});
