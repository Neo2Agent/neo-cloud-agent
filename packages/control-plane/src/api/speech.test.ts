import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "speech-api-secret";
process.env.CONTROL_PLANE_TOKEN = "speech-api-token";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-speech-runs-"));
process.env.ACCOUNTS_REQUIRED = "0";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");

test("POST /v1/speech/iat requires a user session", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  const anon = await fetch(`${base}/v1/speech/iat`, { method: "POST", body: JSON.stringify({ status: 0 }) });
  assert.equal(anon.status, 401);
  const service = await fetch(`${base}/v1/speech/iat`, {
    method: "POST",
    headers: { authorization: "Bearer speech-api-token", "content-type": "application/json" },
    body: JSON.stringify({ status: 0, audio: "" }),
  });
  assert.equal(service.status, 401);
  const body = (await service.json()) as { error?: string };
  assert.equal(body.error, "login_required");
});
