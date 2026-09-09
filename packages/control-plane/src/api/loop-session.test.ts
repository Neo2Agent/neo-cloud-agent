import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mintRunToken } from "@neo-cloud-agent/contracts";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "loop-session-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-loop-session-"));
delete process.env.CONTROL_PLANE_TOKEN;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { createRun } = await import("../orchestrator/orchestrator.js");

test("loop session requires the run JWT and round-trips state", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(() => close(server));
  const run = await createRun({ prompt: "remember this", repoUrls: ["fixtures/toy-repo"] });
  const jwt = mintRunToken("loop-session-secret", {
    sub: "worker",
    runId: run.id,
    orgId: "org_local",
    model: "neo/deepseek",
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: "loop-session-test",
  });
  const url = `http://127.0.0.1:${port}/internal/runs/${run.id}/loop-session`;
  const denied = await fetch(url);
  assert.equal(denied.status, 401);
  const saved = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ state: { messages: [{ role: "user", content: "hi" }] } }),
  });
  assert.equal(saved.status, 202);
  const loaded = await fetch(url, { headers: { authorization: `Bearer ${jwt}` } });
  assert.equal(loaded.status, 200);
  assert.deepEqual(await loaded.json(), { state: { messages: [{ role: "user", content: "hi" }] } });
});
