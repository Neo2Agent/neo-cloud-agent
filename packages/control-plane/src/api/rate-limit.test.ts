import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "rate-limit-secret";
process.env.CONTROL_PLANE_TOKEN = "rate-limit-api-token";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-rate-limit-runs-"));
process.env.ACCOUNTS_REQUIRED = "0";
process.env.RATE_LIMIT_TRUST_PROXY = "1";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { resetRateLimitStore } = await import("../security/rate-limit.js");

const AUTH = { authorization: "Bearer rate-limit-api-token" };

const LIMIT_KEYS = [
  "RATE_LIMIT",
  "RATE_LIMIT_IP",
  "RATE_LIMIT_LOGIN",
  "RATE_LIMIT_LOGIN_ACCOUNT",
  "RATE_LIMIT_LOGIN_BURST",
  "RATE_LIMIT_LOGIN_ACCOUNT_BURST",
  "RATE_LIMIT_API",
  "RATE_LIMIT_WRITE",
  "RATE_LIMIT_CREATE_RUN",
  "RATE_LIMIT_CREATE_RUN_BURST",
  "RATE_LIMIT_FOLLOW_UP",
  "RATE_LIMIT_EXPENSIVE",
  "RATE_LIMIT_WEBHOOK",
  "RATE_LIMIT_SSE",
] as const;

function applyLimits(values: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const key of LIMIT_KEYS) {
    previous.set(key, process.env[key]);
    if (values[key] === undefined) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  resetRateLimitStore();
  return () => {
    for (const key of LIMIT_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetRateLimitStore();
  };
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

test("health is exempt and login / create-run emit 429 with rate-limit headers", async (t) => {
  const restore = applyLimits({
    RATE_LIMIT: "1",
    RATE_LIMIT_IP: "200",
    RATE_LIMIT_LOGIN: "2",
    RATE_LIMIT_LOGIN_ACCOUNT: "2",
    RATE_LIMIT_LOGIN_BURST: "2",
    RATE_LIMIT_LOGIN_ACCOUNT_BURST: "2",
    RATE_LIMIT_API: "80",
    RATE_LIMIT_WRITE: "40",
    RATE_LIMIT_CREATE_RUN: "2",
    RATE_LIMIT_CREATE_RUN_BURST: "2",
    RATE_LIMIT_FOLLOW_UP: "20",
    RATE_LIMIT_EXPENSIVE: "20",
    RATE_LIMIT_WEBHOOK: "80",
  });
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    restore();
  });
  const base = `http://127.0.0.1:${port}`;
  const loginIp = { "x-forwarded-for": "203.0.113.10" };
  const runIp = { "x-forwarded-for": "203.0.113.20" };

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as { rateLimit?: { enabled?: boolean; store?: string } };
  assert.equal(healthBody.rateLimit?.enabled, true);
  assert.equal(healthBody.rateLimit?.store, "memory");

  const loginBody = JSON.stringify({ email: "admin", password: "wrong" });
  const first = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...loginIp },
    body: loginBody,
  });
  const second = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...loginIp },
    body: loginBody,
  });
  const locked = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...loginIp },
    body: loginBody,
  });
  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(locked.status, 429);
  const limited = await json(locked);
  assert.equal(limited.error, "rate_limited");
  assert.ok(limited.policy === "login" || limited.policy === "login_account");
  assert.match(locked.headers.get("retry-after") ?? "", /^\d+$/);
  assert.equal(locked.headers.get("x-ratelimit-remaining"), "0");
  assert.ok(Number(locked.headers.get("x-ratelimit-limit") ?? "0") >= 2);

  const otherIp = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
    body: JSON.stringify({ email: "someone-else", password: "wrong" }),
  });
  assert.equal(otherIp.status, 401);

  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json", ...runIp },
    body: JSON.stringify({ prompt: "one", repoUrls: ["fixtures/toy-repo"] }),
  });
  const createdAgain = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json", ...runIp },
    body: JSON.stringify({ prompt: "two", repoUrls: ["fixtures/toy-repo"] }),
  });
  const createLimited = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json", ...runIp },
    body: JSON.stringify({ prompt: "three", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(created.status, 201);
  assert.equal(createdAgain.status, 201);
  assert.equal(createLimited.status, 429);
  assert.equal(((await json(createLimited)).policy as string) ?? "", "create_run");

  const snapshot = await fetch(`${base}/v1/rate-limits`, { headers: { ...AUTH, ...runIp } });
  assert.equal(snapshot.status, 200);
  const view = (await snapshot.json()) as {
    enabled: boolean;
    policies: { create_run: { remaining: number; limit: number } };
  };
  assert.equal(view.enabled, true);
  assert.equal(view.policies.create_run.limit, 2);
  assert.equal(view.policies.create_run.remaining, 0);
});

test("SSE policy allows one live subscriber per actor then 429", async (t) => {
  const restore = applyLimits({
    RATE_LIMIT: "1",
    RATE_LIMIT_IP: "200",
    RATE_LIMIT_API: "80",
    RATE_LIMIT_WRITE: "40",
    RATE_LIMIT_CREATE_RUN: "10",
    RATE_LIMIT_SSE: "1",
  });
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    restore();
  });
  const base = `http://127.0.0.1:${port}`;
  const ip = { "x-forwarded-for": "198.51.100.7" };
  const created = await fetch(`${base}/v1/runs`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json", ...ip },
    body: JSON.stringify({ prompt: "sse", repoUrls: ["fixtures/toy-repo"] }),
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as { id: string };

  const first = await fetch(`${base}/v1/runs/${run.id}/events`, { headers: { ...AUTH, ...ip } });
  assert.equal(first.status, 200);
  const second = await fetch(`${base}/v1/runs/${run.id}/events`, { headers: { ...AUTH, ...ip } });
  assert.equal(second.status, 429);
  first.body?.cancel();
});
