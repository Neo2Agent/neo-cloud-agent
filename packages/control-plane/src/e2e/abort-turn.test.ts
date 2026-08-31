import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveRun, close, listen, waitForRun } from "./helpers.js";

async function waitForKind(base: string, runId: string, kind: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const transcript = (await (await fetch(`${base}/v1/runs/${runId}/transcript?includeEvents=1`)).json()) as {
      events?: Array<{ kind: string }>;
    };
    if (transcript.events?.some((item) => item.kind === kind)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${kind}`);
}

test("abort during a slow mock stream idles the run before the stream would finish", async (t) => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-e2e-abort-"));
  process.env.WORKER_RUNTIME = "local";
  process.env.SPAWN_LOCAL_WORKER = "1";
  process.env.WORKER_POLL_MS = "50";
  process.env.MOCK_STREAM_DELAY_MS = "200";
  process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-e2e-abort-llm-"));
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_UPSTREAM_API_KEY;
  process.env.LLM_UPSTREAM = "mock";
  process.env.LLM_GATEWAY_JWT_SECRET = "e2e-abort-secret";
  process.env.RUNS_DIR = runsDir;
  process.env.HOST_RUNS_DIR = runsDir;
  process.env.ACCOUNTS_REQUIRED = "0";
  delete process.env.WORKER_CONTROL_PLANE_URL;
  delete process.env.WORKER_LLM_GATEWAY_URL;

  const { createGatewayServer } = await import("../../../llm-gateway/src/server.js");
  const { createApiServer } = await import("../api/server.js");

  const gateway = createGatewayServer();
  const gatewayPort = await listen(gateway);
  process.env.LLM_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
  process.env.LLM_GATEWAY_PORT = String(gatewayPort);

  const api = createApiServer();
  const apiPort = await listen(api);
  process.env.CONTROL_PLANE_URL = `http://127.0.0.1:${apiPort}`;
  process.env.CONTROL_PLANE_PORT = String(apiPort);
  const apiBase = `http://127.0.0.1:${apiPort}`;
  let runId = "";
  t.after(async () => {
    if (runId) {
      await archiveRun(apiBase, runId);
    }
    await close(api);
    await close(gateway);
    process.env.WORKER_RUNTIME = "none";
    delete process.env.MOCK_STREAM_DELAY_MS;
    delete process.env.WORKER_POLL_MS;
  });

  const created = await fetch(`${apiBase}/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "慢慢说完整段话。不要调用工具。",
      repoUrls: ["fixtures/toy-repo"],
      source: "api",
    }),
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as { id: string; status: string; errorMessage: string | null };
  runId = run.id;
  assert.equal(run.status, "RUNNING", run.errorMessage ?? "");

  await waitForKind(apiBase, run.id, "agent.start", 30_000);
  const abortStarted = Date.now();
  const aborted = await fetch(`${apiBase}/v1/runs/${run.id}/abort`, { method: "POST" });
  assert.equal(aborted.status, 200);

  const result = await waitForRun(apiBase, run.id, 8_000);
  assert.notEqual(result.status, "ERROR", result.errorMessage ?? result.kinds.join(","));
  assert.equal(result.status, "IDLE");
  assert.ok(result.kinds.includes("agent.end"));
  assert.ok(
    Date.now() - abortStarted < 5_000,
    `stop should interrupt the slow mock stream, took ${Date.now() - abortStarted}ms`,
  );
});
