import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "devices-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-devices-api-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");
const { EXPO_PUSH_URL } = await import("../notify/expo.js");
const { sendNotifyText, resetNotifyCoalesceForTests } = await import("../notify/dispatch.js");

async function login(base: string): Promise<string> {
  await ensureDefaultAdmin();
  const login = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin", password: "123456" }),
  });
  assert.equal(login.status, 200);
  const session = (await login.json()) as { token: string };
  return session.token;
}

test("devices API registers, lists without the token, and fans out Expo push", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    delete process.env.ACCOUNTS_REQUIRED;
  });
  const base = `http://127.0.0.1:${port}`;
  const token = await login(base);
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

  const denied = await fetch(`${base}/v1/devices`);
  assert.equal(denied.status, 401);

  const created = await fetch(`${base}/v1/devices`, {
    method: "POST",
    headers,
    body: JSON.stringify({ platform: "ios", pushToken: "ExponentPushToken[mobile-1]" }),
  });
  assert.equal(created.status, 201);
  const device = (await created.json()) as { id: string; platform: string; pushToken?: string };
  assert.equal(device.platform, "ios");
  assert.equal(device.pushToken, undefined);

  const listed = await fetch(`${base}/v1/devices`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(listed.status, 200);
  const body = (await listed.json()) as { devices: Array<{ id: string }> };
  assert.equal(body.devices.some((item) => item.id === device.id), true);

  const env = await fetch(`${base}/v1/environments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "phone", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(env.status, 201);
  const environment = (await env.json()) as { id: string };
  const run = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: "from the phone", envId: environment.id, source: "ios" }),
  });
  assert.equal(run.status, 201);
  const createdRun = (await run.json()) as { id: string; source: string; repoUrls: string[] };
  assert.equal(createdRun.source, "ios");
  assert.deepEqual(createdRun.repoUrls, ["fixtures/toy-repo"]);

  resetNotifyCoalesceForTests();
  const pushed: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === EXPO_PUSH_URL) {
      pushed.push(JSON.parse(String(init?.body ?? "[]")));
      return new Response(JSON.stringify({ data: [{ status: "ok" }] }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const sent = await sendNotifyText("对话做完了\nfrom the phone", {
    userId: (await (await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${token}` } })).json() as { user: { id: string } }).user.id,
    runId: createdRun.id,
    kind: "idle",
  });
  assert.ok(sent >= 1);
  const messages = (pushed[0] as Array<{ to: string; data: { runId: string; kind: string } }>) ?? [];
  assert.equal(messages[0]?.to, "ExponentPushToken[mobile-1]");
  assert.equal(messages[0]?.data.runId, createdRun.id);
  assert.equal(messages[0]?.data.kind, "idle");

  const removed = await fetch(`${base}/v1/devices/${device.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(removed.status, 200);
});
