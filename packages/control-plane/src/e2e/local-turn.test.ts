import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveRun, close, listen, waitForRun } from "./helpers.js";

test("in-process mock turn: clone toy repo, worker reaches IDLE", async (t) => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-e2e-"));
  process.env.WORKER_RUNTIME = "local";
  process.env.SPAWN_LOCAL_WORKER = "1";
  process.env.AGENT_KERNEL = "pi";
  process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-e2e-llm-"));
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_UPSTREAM_API_KEY;
  process.env.LLM_UPSTREAM = "mock";
  process.env.LLM_GATEWAY_JWT_SECRET = "e2e-secret";
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
  });

  const created = await fetch(`${apiBase}/v1/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "只回复一个词：pong。不要调用工具。",
      repoUrls: ["fixtures/toy-repo"],
      source: "api",
    }),
  });
  assert.equal(created.status, 201);
  const run = (await created.json()) as { id: string; status: string; errorMessage: string | null };
  runId = run.id;
  assert.equal(run.status, "RUNNING", run.errorMessage ?? "");
  assert.ok(existsSync(path.join(runsDir, run.id, "hello.txt")));
  assert.ok(existsSync(path.join(runsDir, run.id, ".neo-installed")));

  const result = await waitForRun(apiBase, run.id, 60_000);
  assert.notEqual(result.status, "ERROR", result.errorMessage ?? result.kinds.join(","));
  assert.ok(existsSync(path.join(runsDir, run.id, ".neo-started")));
  assert.ok(existsSync(path.join(runsDir, run.id, ".neo-terminal")));
  assert.ok(result.kinds.includes("scm.clone_succeeded"));
  assert.ok(result.kinds.includes("run.start_succeeded"));
  assert.ok(result.kinds.includes("run.terminal_started"));
  assert.ok(result.kinds.includes("agent.start"));
  assert.ok(result.kinds.includes("agent.end"));
  assert.equal(result.status, "IDLE");
  assert.match(readFileSync(path.join(runsDir, run.id, "hello.txt"), "utf8"), /toy repo/);
});
