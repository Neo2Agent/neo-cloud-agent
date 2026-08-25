import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mintRunToken } from "@neo-cloud-agent/contracts";
import { createGatewayServer } from "./server.js";
import { resetGatewayRateLimitStore } from "./rate-limit.js";

test("gateway limits chat completions per run JWT and reports headers", async (t) => {
  const isolated = mkdtempSync(path.join(tmpdir(), "neo-gw-rl-"));
  process.env.LLM_SETTINGS_DIR = isolated;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_UPSTREAM_API_KEY;
  process.env.LLM_GATEWAY_JWT_SECRET = "rate-limit-gw-secret";
  process.env.LLM_UPSTREAM = "mock";
  process.env.RATE_LIMIT = "1";
  process.env.RATE_LIMIT_LLM_RUN = "2";
  process.env.RATE_LIMIT_LLM_RUN_BURST = "2";
  process.env.RATE_LIMIT_LLM_ORG = "20";
  process.env.RATE_LIMIT_LLM_INFLIGHT_RUN = "2";
  process.env.RATE_LIMIT_LLM_INFLIGHT_ORG = "4";
  resetGatewayRateLimitStore();

  const server = createGatewayServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("no listen port");
  }
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    resetGatewayRateLimitStore();
    delete process.env.RATE_LIMIT;
    delete process.env.RATE_LIMIT_LLM_RUN;
    delete process.env.RATE_LIMIT_LLM_RUN_BURST;
  });

  const url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  const health = (await (await fetch(`http://127.0.0.1:${address.port}/health`)).json()) as {
    rateLimit?: { enabled?: boolean };
  };
  assert.equal(health.rateLimit?.enabled, true);

  const token = mintRunToken("rate-limit-gw-secret", {
    sub: "user",
    runId: "run-rl-1",
    orgId: "org-rl",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 60,
    jti: "jti-rl",
  });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const body = JSON.stringify({ model: "neo/deepseek", messages: [{ role: "user", content: "hi" }] });
  const first = await fetch(url, { method: "POST", headers, body });
  const second = await fetch(url, { method: "POST", headers, body });
  const third = await fetch(url, { method: "POST", headers, body });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);
  const limited = (await third.json()) as { error?: string; policy?: string };
  assert.equal(limited.error, "rate_limited");
  assert.equal(limited.policy, "llm_run");
  assert.equal(third.headers.get("x-ratelimit-policy"), "llm_run");
  assert.match(third.headers.get("retry-after") ?? "", /^\d+$/);
});
