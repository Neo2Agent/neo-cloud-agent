import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "auth-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-auth-"));
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { mintRunToken } = await import("@neo-cloud-agent/contracts");
const { createRun } = await import("../orchestrator/orchestrator.js");

test("public API requires the control-plane token; workers use the run JWT", async (t) => {
  process.env.CONTROL_PLANE_TOKEN = "super-secret-token";
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    delete process.env.CONTROL_PLANE_TOKEN;
  });
  const base = `http://127.0.0.1:${port}`;

  const denied = await fetch(`${base}/v1/runs`);
  assert.equal(denied.status, 401);

  const listed = await fetch(`${base}/v1/runs`, {
    headers: { authorization: "Bearer super-secret-token" },
  });
  assert.equal(listed.status, 200);

  const authed = await fetch(`${base}/v1/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "super-secret-token" }),
  });
  assert.equal(authed.status, 200);
  assert.match(authed.headers.get("set-cookie") ?? "", /neo_token=/);

  const created = await createRun({ prompt: "auth me", repoUrls: ["fixtures/toy-repo"] });
  const jwt = mintRunToken("auth-secret", {
    sub: "worker",
    runId: created.id,
    orgId: "org_local",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "auth-test",
  });
  const inboxDenied = await fetch(`${base}/internal/runs/${created.id}/inbox`, { method: "POST" });
  assert.equal(inboxDenied.status, 401);
  const inbox = await fetch(`${base}/internal/runs/${created.id}/inbox`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
  });
  assert.equal(inbox.status, 200);

  const health = (await (await fetch(`${base}/health`)).json()) as { authRequired: boolean };
  assert.equal(health.authRequired, true);
});
