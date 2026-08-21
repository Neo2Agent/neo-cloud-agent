import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Run } from "@neo-cloud-agent/contracts";
import { getConfig } from "./config.js";

const children = new Map<string, ChildProcess>();

function repoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

export function workspaceFor(runId: string): string {
  return path.join(getConfig().runsDir, runId);
}

export function spawnLocalWorker(run: Run, jwt: string): ChildProcess {
  const config = getConfig();
  const workspace = workspaceFor(run.id);
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.join(workspace, "sessions"), { recursive: true });

  const tsxCli = fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
  const workerEntry = fileURLToPath(new URL("../../worker/src/index.ts", import.meta.url));
  const child = spawn(process.execPath, [tsxCli, workerEntry], {
    cwd: repoRoot(),
    env: {
      ...process.env,
      RUN_ID: run.id,
      LLM_GATEWAY_JWT: jwt,
      LLM_GATEWAY_URL: config.llmGatewayUrl,
      CONTROL_PLANE_URL: config.controlPlaneUrl,
      WORKSPACE_DIR: workspace,
      SESSION_DIR: path.join(workspace, "sessions"),
      NEO_MODEL: run.model,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[worker ${run.id}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[worker ${run.id}] ${chunk}`));
  children.set(run.id, child);
  return child;
}

export function stopLocalWorker(runId: string): void {
  const child = children.get(runId);
  if (!child) {
    return;
  }
  child.kill("SIGTERM");
  children.delete(runId);
}
