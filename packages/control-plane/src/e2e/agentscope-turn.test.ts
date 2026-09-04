import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { archiveRun, close, listen, waitForRun } from "./helpers.js";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const loopPom = path.join(repoRoot, "services/neo-loop/pom.xml");
const enabled = process.env.AGENT_SCOPE_E2E === "1" && existsSync(loopPom);

function startLoop(port: number, stateDir: string): ChildProcess {
  return spawn("mvn", ["-f", loopPom, "-q", "spring-boot:run", `-Dspring-boot.run.arguments=--server.port=${port}`], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEO_LOOP_PORT: String(port),
      NEO_LOOP_BIND: "127.0.0.1",
      NEO_LOOP_TOKEN: "",
      NEO_LOOP_STATE_DIR: stateDir,
      LOOP_ENGINE: "react",
      MAVEN_OPTS: "-Xmx512m",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      last = String(response.status);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`neo-loop did not become ready: ${last}`);
}

test(
  "agentscope local worker mock turn reaches IDLE",
  { skip: !enabled, timeout: 240_000 },
  async (t) => {
    const runsDir = mkdtempSync(path.join(tmpdir(), "neo-as-e2e-"));
    const loopState = mkdtempSync(path.join(tmpdir(), "neo-as-loop-"));
    process.env.WORKER_RUNTIME = "local";
    process.env.SPAWN_LOCAL_WORKER = "1";
    process.env.LLM_UPSTREAM = "mock";
    process.env.AGENT_KERNEL = "agentscope";
    process.env.LLM_GATEWAY_JWT_SECRET = "e2e-secret";
    process.env.RUNS_DIR = runsDir;
    process.env.HOST_RUNS_DIR = runsDir;
    process.env.ACCOUNTS_REQUIRED = "0";
    process.env.WORKER_IDLE_RELEASE_MS = "0";

    const { createGatewayServer } = await import("../../../llm-gateway/src/server.js");
    const { createApiServer } = await import("../api/server.js");
    const gateway = createGatewayServer();
    const gatewayPort = await listen(gateway);
    process.env.LLM_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
    process.env.LLM_GATEWAY_PORT = String(gatewayPort);
    process.env.WORKER_LLM_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;

    const loopPort = 18_000 + Math.floor(Math.random() * 1000);
    process.env.NEO_LOOP_URL = `http://127.0.0.1:${loopPort}`;
    const loop = startLoop(loopPort, loopState);
    loop.stdout?.on("data", (chunk) => process.stderr.write(`[neo-loop] ${chunk}`));
    loop.stderr?.on("data", (chunk) => process.stderr.write(`[neo-loop] ${chunk}`));
    await waitHttp(`http://127.0.0.1:${loopPort}/health`, 180_000);

    const api = createApiServer();
    const apiPort = await listen(api);
    process.env.CONTROL_PLANE_URL = `http://127.0.0.1:${apiPort}`;
    process.env.CONTROL_PLANE_PORT = String(apiPort);
    process.env.WORKER_CONTROL_PLANE_URL = `http://127.0.0.1:${apiPort}`;
    const apiBase = `http://127.0.0.1:${apiPort}`;
    let runId = "";
    t.after(async () => {
      if (runId) {
        await archiveRun(apiBase, runId);
      }
      await close(api);
      await close(gateway);
      loop.kill("SIGTERM");
      process.env.WORKER_RUNTIME = "none";
      delete process.env.AGENT_KERNEL;
    });

    const created = await fetch(`${apiBase}/v1/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "只回复一个词：pong。不要调用工具。",
        repoUrls: ["fixtures/toy-repo"],
        source: "api",
        kernel: "agentscope",
      }),
    });
    const createdBody = await created.text();
    assert.equal(created.status, 201, createdBody);
    const run = JSON.parse(createdBody) as { id: string; status: string; errorMessage: string | null; kernel?: string };
    runId = run.id;
    assert.equal(run.kernel, "agentscope");
    assert.equal(run.status, "RUNNING", run.errorMessage ?? "");

    const result = await waitForRun(apiBase, run.id, 120_000);
    assert.notEqual(result.status, "ERROR", result.errorMessage ?? result.kinds.join(","));
    assert.ok(result.kinds.includes("agent.start"), result.kinds.join(","));
    assert.ok(result.kinds.includes("agent.end"), result.kinds.join(","));
    assert.equal(result.status, "IDLE");
  },
);
