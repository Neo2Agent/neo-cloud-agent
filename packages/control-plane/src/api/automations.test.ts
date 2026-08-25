import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Automation, Run } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "auto-api-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-auto-api-"));
process.env.ACCOUNTS_REQUIRED = "1";
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { createTeammateAccount, ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await response.json()) as { token: string; user: { id: string; email: string; orgId: string } };
}

function auth(token: string) {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

test("POST /v1/automations/:id/run reuses the saved prompt", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => close(server));
  const base = `http://127.0.0.1:${port}`;
  await ensureDefaultAdmin();
  const admin = await login(base, "admin", "123456");
  await createTeammateAccount({ email: "ping", password: "654321", orgId: admin.user.orgId });
  const mate = await login(base, "ping", "654321");

  const createdRes = await fetch(`${base}/v1/automations`, {
    method: "POST",
    headers: auth(admin.token),
    body: JSON.stringify({
      name: "复用检查",
      prompt: "复用已有自动化，开一轮新对话",
      schedule: { kind: "every", minutes: 60 },
    }),
  });
  assert.equal(createdRes.status, 201);
  const item = (await createdRes.json()) as Automation;
  const scheduled = item.nextRunAt;

  const anon = await fetch(`${base}/v1/automations/${item.id}/run`, { method: "POST" });
  assert.equal(anon.status, 401);

  const missing = await fetch(`${base}/v1/automations/auto_missing/run`, {
    method: "POST",
    headers: auth(admin.token),
    body: "{}",
  });
  assert.equal(missing.status, 404);

  const foreign = await fetch(`${base}/v1/automations/${item.id}/run`, {
    method: "POST",
    headers: auth(mate.token),
    body: "{}",
  });
  assert.equal(foreign.status, 403);

  const started = await fetch(`${base}/v1/automations/${item.id}/run`, {
    method: "POST",
    headers: auth(admin.token),
    body: "{}",
  });
  assert.equal(started.status, 201);
  const run = (await started.json()) as Run;
  assert.equal(run.source, "automation");
  assert.equal(run.prompt, "复用已有自动化，开一轮新对话");
  assert.equal(run.userId, admin.user.id);

  const listed = (await (await fetch(`${base}/v1/automations`, { headers: auth(admin.token) })).json()) as {
    automations: Automation[];
  };
  const later = listed.automations.find((row) => row.id === item.id);
  assert.equal(later?.lastRunId, run.id);
  assert.equal(later?.nextRunAt, scheduled);

  const busy = await fetch(`${base}/v1/automations/${item.id}/run`, {
    method: "POST",
    headers: auth(admin.token),
    body: "{}",
  });
  assert.equal(busy.status, 409);
});
