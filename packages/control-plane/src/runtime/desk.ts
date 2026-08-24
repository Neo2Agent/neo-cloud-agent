import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import type { RuntimeHooks } from "./docker.js";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

/** Claim-style runtime: the control plane does not spawn the worker. */
export class DeskRuntime implements ExecutionRuntime {
  private readonly adopted = new Map<string, { pid: number; timer: ReturnType<typeof setInterval> }>();

  async provision(spec: RuntimeSpec, _hooks?: RuntimeHooks): Promise<RuntimeHandle> {
    return { id: `desk-${spec.runId}`, runtime: "desk", ip: null };
  }

  async snapshot(handle: RuntimeHandle): Promise<string> {
    return `snap-${handle.id}`;
  }

  async restore(snapshotId: string, spec: RuntimeSpec): Promise<RuntimeHandle> {
    return { id: `desk-${spec.runId}-from-${snapshotId}`, runtime: "desk", ip: null };
  }

  async adopt(
    runId: string,
    lease: { handleId?: string; pid?: number | null } | null,
    hooks?: RuntimeHooks,
  ): Promise<RuntimeHandle | null> {
    const pid = lease?.pid;
    if (!pid || !alive(pid)) {
      return null;
    }
    const timer = setInterval(() => {
      if (alive(pid)) {
        return;
      }
      clearInterval(timer);
      this.adopted.delete(runId);
      hooks?.onExit?.(null);
    }, 1000);
    timer.unref();
    this.adopted.set(runId, { pid, timer });
    return { id: lease?.handleId ?? `desk-${runId}`, runtime: "desk", ip: null, pid };
  }

  async destroy(handle: RuntimeHandle): Promise<void> {
    const runId = handle.id.startsWith("desk-") ? handle.id.slice("desk-".length) : handle.id;
    const adopted = this.adopted.get(runId);
    if (adopted) {
      clearInterval(adopted.timer);
      this.adopted.delete(runId);
    }
    const pid = adopted?.pid ?? handle.pid ?? null;
    if (pid) {
      await terminatePid(pid);
    }
  }
}
