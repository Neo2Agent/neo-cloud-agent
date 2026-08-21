import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import { repoRoot } from "../worker-spawn.js";
import type { RuntimeHooks } from "./docker.js";
import { assertNoProviderSecrets, buildWorkerEnv } from "./worker-env.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateChild(child: ChildProcess, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function terminatePid(pid: number, timeoutMs = 3000): Promise<void> {
  if (!alive(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (alive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

export class LocalProcessRuntime implements ExecutionRuntime {
  private readonly children = new Map<string, ChildProcess>();
  private readonly adopted = new Map<string, { pid: number; timer: ReturnType<typeof setInterval> }>();

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
      egressMode: spec.egress.mode,
      egressDomains: spec.egress.domains,
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
    return { id: `local-${spec.runId}`, runtime: "local", ip: null, pid: child.pid ?? null };
  }

  async adopt(runId: string, lease: { handleId?: string; pid?: number | null } | null, hooks?: RuntimeHooks): Promise<RuntimeHandle | null> {
    const pid = lease?.pid;
    if (!pid || !alive(pid)) {
      return null;
    }
    const timer = setInterval(() => {
      if (alive(pid)) {
        return;
      }
      clearInterval(timer);
      this.children.delete(runId);
      hooks?.onExit?.(null);
    }, 1000);
    timer.unref();
    this.adopted.set(runId, { pid, timer });
    return { id: lease?.handleId ?? `local-${runId}`, runtime: "local", ip: null, pid };
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
    const adopted = this.adopted.get(runId);
    if (adopted) {
      clearInterval(adopted.timer);
      this.adopted.delete(runId);
    }
    if (child) {
      this.children.delete(runId);
      await terminateChild(child);
      return;
    }
    const pid = adopted?.pid ?? handle.pid ?? null;
    if (pid) {
      await terminatePid(pid);
    }
  }
}
