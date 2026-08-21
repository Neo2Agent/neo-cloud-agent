import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveRun, close, listen, waitForRun } from "./helpers.js";
import { firecrackerAvailable, resolveFirecrackerBin } from "../runtime/firecracker.js";
import { isProductionRootfs, productionFirecrackerPaths } from "../runtime/rootfs.js";

function liveReady(): { ready: boolean; reason: string } {
  const paths = productionFirecrackerPaths();
  const bin = resolveFirecrackerBin();
  if (!existsSync("/dev/kvm")) {
    return { ready: false, reason: "no /dev/kvm" };
  }
  if (!firecrackerAvailable(bin)) {
    return { ready: false, reason: "firecracker binary missing" };
  }
  if (bin.includes("/") && !existsSync(bin)) {
    return { ready: false, reason: `firecracker binary missing: ${bin}` };
  }
  if (!existsSync(paths.kernel) || statSync(paths.kernel).size < 1_000_000) {
    return { ready: false, reason: `kernel missing: ${paths.kernel}` };
  }
  if (!isProductionRootfs(paths.rootfs)) {
    return { ready: false, reason: `production rootfs missing: ${paths.rootfs}` };
  }
  return { ready: true, reason: "" };
}

const ready = liveReady();
const enabled = process.env.FIRECRACKER_E2E === "1";

test(
  "firecracker worker mock turn: boot production rootfs and reach IDLE",
  { skip: !enabled || !ready.ready, timeout: 180_000 },
  async (t) => {
    const paths = productionFirecrackerPaths();
    const runsDir = mkdtempSync(path.join(tmpdir(), "neo-fc-e2e-"));
    process.env.WORKER_RUNTIME = "firecracker";
    process.env.SPAWN_LOCAL_WORKER = "0";
    process.env.LLM_UPSTREAM = "mock";
    process.env.LLM_GATEWAY_JWT_SECRET = "e2e-secret";
    process.env.RUNS_DIR = runsDir;
    process.env.HOST_RUNS_DIR = runsDir;
    process.env.FIRECRACKER_BIN = resolveFirecrackerBin();
    process.env.FIRECRACKER_KERNEL = paths.kernel;
    process.env.FIRECRACKER_ROOTFS = paths.rootfs;
    process.env.FIRECRACKER_NET = "tap";
    process.env.WORKER_MEMORY_MIB = "2048";
    process.env.WORKER_DISK_GIB = "1";
    delete process.env.WORKER_CONTROL_PLANE_URL;
    delete process.env.WORKER_LLM_GATEWAY_URL;

    const { createGatewayServer } = await import("../../../llm-gateway/src/server.js");
    const { createApiServer } = await import("../api/server.js");

    const gateway = createGatewayServer();
    const gatewayPort = await listen(gateway, "0.0.0.0");
    process.env.LLM_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
    process.env.LLM_GATEWAY_PORT = String(gatewayPort);

    const api = createApiServer();
    const apiPort = await listen(api, "0.0.0.0");
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

    const result = await waitForRun(apiBase, run.id, 150_000);
    assert.notEqual(result.status, "ERROR", result.errorMessage ?? result.kinds.join(","));
    assert.ok(result.kinds.includes("scm.clone_succeeded"));
    assert.ok(result.kinds.includes("run.start_succeeded"));
    assert.ok(result.kinds.includes("run.terminal_started"));
    assert.ok(result.kinds.includes("run.running"));
    assert.ok(result.kinds.includes("agent.start"));
    assert.ok(result.kinds.includes("agent.end"));
    assert.equal(result.status, "IDLE");
  },
);
