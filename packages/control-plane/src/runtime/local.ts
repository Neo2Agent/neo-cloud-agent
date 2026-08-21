import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import { repoRoot } from "../worker-spawn.js";
import type { RuntimeHooks } from "./docker.js";
import { assertNoProviderSecrets, buildWorkerEnv } from "./worker-env.js";

export class LocalProcessRuntime implements ExecutionRuntime {
  private readonly children = new Map<string, ChildProcess>();

  async provision(spec: RuntimeSpec, hooks?: RuntimeHooks): Promise<RuntimeHandle> {
    mkdirSync(spec.hostWorkspaceDir, { recursive: true });
    const sessionDir = path.join(spec.hostWorkspaceDir, "sessions");
    mkdirSync(sessionDir, { recursive: true });

    const env = buildWorkerEnv({
      runId: spec.runId,
      jwt: spec.jwt,
      controlPlaneUrl: spec.controlPlaneUrl,
      llmGatewayUrl: spec.llmGatewayUrl,
      workspaceDir: spec.hostWorkspaceDir,
      sessionDir,
      model: spec.model,
    });
    assertNoProviderSecrets(env);

    const tsxCli = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
    const workerEntry = fileURLToPath(new URL("../../../worker/src/index.ts", import.meta.url));
    const child = spawn(process.execPath, [tsxCli, workerEntry], {
      cwd: repoRoot(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      process.stdout.write(`[worker ${spec.runId}] ${text}`);
      hooks?.onLog?.(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      process.stderr.write(`[worker ${spec.runId}] ${text}`);
      hooks?.onLog?.(text);
    });
    child.once("exit", (code) => {
      this.children.delete(spec.runId);
      hooks?.onExit?.(code);
    });
    this.children.set(spec.runId, child);
    return { id: `local-${spec.runId}`, runtime: "local", ip: null };
  }

  async snapshot(handle: RuntimeHandle): Promise<string> {
    return `snap-${handle.id}`;
  }

  async restore(snapshotId: string, spec: RuntimeSpec): Promise<RuntimeHandle> {
    return { id: `local-${spec.runId}-from-${snapshotId}`, runtime: "local", ip: null };
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    const runId = handle.id.startsWith("local-") ? handle.id.slice("local-".length) : handle.id;
    const child = this.children.get(runId);
    if (!child) {
      return;
    }
    child.kill("SIGTERM");
    this.children.delete(runId);
  }
}
