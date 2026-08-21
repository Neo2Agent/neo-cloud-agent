import assert from "node:assert/strict";
import type { Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no listen port"));
        return;
      }
      resolve(address.port);
    });
    server.on("error", reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("in-process mock turn: clone toy repo, worker reaches IDLE", async (t) => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-e2e-"));
  process.env.WORKER_RUNTIME = "local";
  process.env.SPAWN_LOCAL_WORKER = "1";
  process.env.LLM_UPSTREAM = "mock";
  process.env.LLM_GATEWAY_JWT_SECRET = "e2e-secret";
  process.env.RUNS_DIR = runsDir;
  process.env.HOST_RUNS_DIR = runsDir;
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
  t.after(async () => {
    await close(api);
    await close(gateway);
    process.env.WORKER_RUNTIME = "none";
  });

  const created = await fetch(`http://127.0.0.1:${apiPort}/v1/runs`, {
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
  assert.equal(run.status, "RUNNING", run.errorMessage ?? "");
  assert.ok(existsSync(path.join(runsDir, run.id, "hello.txt")));

  const deadline = Date.now() + 60_000;
  let kinds: string[] = [];
  let status = run.status;
  while (Date.now() < deadline) {
    const transcript = (await (await fetch(`http://127.0.0.1:${apiPort}/v1/runs/${run.id}/transcript`)).json()) as {
      events: Array<{ kind: string }>;
    };
    kinds = transcript.events.map((item) => item.kind);
    const latest = (await (await fetch(`http://127.0.0.1:${apiPort}/v1/runs/${run.id}`)).json()) as {
      status: string;
      errorMessage: string | null;
    };
    status = latest.status;
    if (kinds.includes("agent.end") || status === "ERROR" || status === "IDLE") {
      assert.notEqual(status, "ERROR", latest.errorMessage ?? kinds.join(","));
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  assert.ok(kinds.includes("scm.clone_succeeded"));
  assert.ok(kinds.includes("agent.start"));
  assert.ok(kinds.includes("agent.end"));
  assert.equal(status, "IDLE");
  assert.match(readFileSync(path.join(runsDir, run.id, "hello.txt"), "utf8"), /toy repo/);
});
