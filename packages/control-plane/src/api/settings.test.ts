import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "settings-secret";
process.env.CONTROL_PLANE_TOKEN = "settings-api-token";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-settings-runs-"));
process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-settings-llm-"));
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.ACCOUNTS_REQUIRED;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;
delete process.env.GITHUB_APP_INSTALLATION_ID;
delete process.env.SCM_PUSH_TOKEN;
delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");

const AUTH = { authorization: "Bearer settings-api-token" };

test("llm settings API stores a key without ever returning it", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;

  const denied = await fetch(`${base}/v1/settings/llm`);
  assert.equal(denied.status, 401);

  const before = (await (await fetch(`${base}/v1/settings/llm`, { headers: AUTH })).json()) as {
    configured: boolean;
    upstream: string;
  };
  assert.equal(before.configured, false);

  const missing = await fetch(`${base}/v1/settings/llm`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ upstream: "deepseek" }),
  });
  assert.equal(missing.status, 400);

  const saved = await fetch(`${base}/v1/settings/llm`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ upstream: "deepseek", apiKey: "sk-never-echo" }),
  });
  assert.equal(saved.status, 200);
  const published = (await saved.json()) as { configured: boolean; upstream: string; model: string };
  assert.equal(published.configured, true);
  assert.equal(published.upstream, "deepseek");
  assert.equal(published.model, "deepseek-v4-flash");
  assert.doesNotMatch(JSON.stringify(published), /sk-never-echo/);

  const health = (await (await fetch(`${base}/health`)).json()) as {
    llmConfigured: boolean;
    llmUpstream: string;
  };
  assert.equal(health.llmConfigured, true);
  assert.equal(health.llmUpstream, "deepseek");
  assert.doesNotMatch(JSON.stringify(health), /sk-never-echo/);

  const scmDenied = await fetch(`${base}/v1/settings/scm`);
  assert.equal(scmDenied.status, 401);
  const scmBefore = (await (await fetch(`${base}/v1/settings/scm`, { headers: AUTH })).json()) as {
    configured: boolean;
    method: string;
  };
  assert.equal(scmBefore.configured, false);
  const scmSaved = await fetch(`${base}/v1/settings/scm`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ token: "ghp_settings_pat" }),
  });
  assert.equal(scmSaved.status, 200);
  const scmPublished = (await scmSaved.json()) as { configured: boolean; method: string };
  assert.equal(scmPublished.configured, true);
  assert.equal(scmPublished.method, "pat");
  assert.doesNotMatch(JSON.stringify(scmPublished), /ghp_settings_pat/);
  const scmHealth = (await (await fetch(`${base}/health`)).json()) as {
    scmPush?: { configured?: boolean; method?: string };
    objectStore?: string;
  };
  assert.equal(scmHealth.scmPush?.method, "pat");
  assert.equal(scmHealth.objectStore, "fs");
  await fetch(`${base}/v1/settings/scm`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ clear: true }),
  });

  const again = await fetch(`${base}/v1/settings/llm`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ upstream: "openai" }),
  });
  const kept = (await again.json()) as { configured: boolean; upstream: string };
  assert.equal(again.status, 200);
  assert.equal(kept.configured, true);
  assert.equal(kept.upstream, "openai");
  assert.doesNotMatch(JSON.stringify(kept), /sk-never-echo/);
});
