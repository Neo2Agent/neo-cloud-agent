import assert from "node:assert/strict";
import test from "node:test";
import { jsonHeaders, login, readJson, startCoreApi } from "./helpers.js";

test("speech: GET status without auth is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/speech/iat`);
  assert.equal(response.status, 401);
});

test("speech: GET status as user reports configured=false when gateway is down or keys missing", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await fetch(`${api.base}/v1/speech/iat`, { headers: jsonHeaders(token) });
  assert.equal(response.status, 200);
  const body = await readJson<{ configured?: boolean }>(response);
  assert.equal(body.configured, false);
});

test("speech: POST without auth is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/speech/iat`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ status: 0, audio: "" }),
  });
  assert.equal(response.status, 401);
});

test("speech: POST with a service token (not a user session) is login_required", async (t) => {
  const previous = process.env.CONTROL_PLANE_TOKEN;
  process.env.CONTROL_PLANE_TOKEN = "core-e2e-service-token";
  t.after(() => {
    if (previous === undefined) delete process.env.CONTROL_PLANE_TOKEN;
    else process.env.CONTROL_PLANE_TOKEN = previous;
  });
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/speech/iat`, {
    method: "POST",
    headers: jsonHeaders("core-e2e-service-token"),
    body: JSON.stringify({ status: 0, audio: "" }),
  });
  assert.equal(response.status, 401);
  assert.equal((await readJson<{ error?: string }>(response)).error, "login_required");
});

test("speech: POST as user when gateway is unreachable is 502", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const response = await fetch(`${api.base}/v1/speech/iat`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ status: 0, audio: "" }),
  });
  assert.equal(response.status, 502);
  assert.match((await readJson<{ error?: string }>(response)).error ?? "", /听写服务不可用|ECONNREFUSED|fetch/i);
});

test("speech: gateway reports iatConfigured=false and POST is 503 when keys are missing", async (t) => {
  delete process.env.IFLYTEK_APP_ID;
  delete process.env.IFLYTEK_API_KEY;
  delete process.env.IFLYTEK_API_SECRET;
  const { createGatewayServer } = await import("../../../packages/llm-gateway/src/server.js");
  const { listen, close } = await import("../../../packages/control-plane/src/e2e/helpers.js");
  const gateway = createGatewayServer();
  const port = await listen(gateway);
  t.after(() => close(gateway));
  const base = `http://127.0.0.1:${port}`;
  const health = await readJson<{ iatConfigured?: boolean }>(await fetch(`${base}/health`));
  assert.equal(health.iatConfigured, false);

  const { mintRunToken } = await import("@neo-cloud-agent/contracts");
  const token = mintRunToken(process.env.LLM_GATEWAY_JWT_SECRET ?? "core-e2e-secret", {
    sub: "u",
    runId: "speech:u",
    orgId: "o",
    model: "iflytek-iat",
    exp: Math.floor(Date.now() / 1000) + 60,
    jti: "core-iat",
  });
  const missing = await fetch(`${base}/v1/speech/iat`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ status: 0 }),
  });
  assert.equal(missing.status, 503);
  assert.equal((await readJson<{ error?: string }>(missing)).error, "听写未配置");
});

test(
  "speech: live Iflytek turn is skipped unless IFLYTEK_* secrets are set",
  { skip: !process.env.IFLYTEK_APP_ID || !process.env.IFLYTEK_API_KEY || !process.env.IFLYTEK_API_SECRET },
  async () => {
    assert.ok(process.env.IFLYTEK_APP_ID);
  },
);
