import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "accounts-default-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-accounts-default-"));
delete process.env.ACCOUNTS_REQUIRED;
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");

test("accounts stay required when ACCOUNTS_REQUIRED is unset", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;

  const health = (await (await fetch(`${base}/health`)).json()) as {
    authRequired?: boolean;
    accountsRequired?: boolean;
  };
  assert.equal(health.authRequired, true);
  assert.equal(health.accountsRequired, true);

  const denied = await fetch(`${base}/v1/runs`);
  assert.equal(denied.status, 401);

  const empty = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "", password: "" }),
  });
  assert.equal(empty.status, 401);

  const token = await fetch(`${base}/v1/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "anything" }),
  });
  assert.equal(token.status, 401);
});
