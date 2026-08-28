import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import type { RuntimeHooks } from "./docker.js";

/**
 * Claim-style runtime: the control plane never spawns and never signals.
 *
 * The worker runs on the user's own computer, so a pid here is not ours to
 * check or kill — in production the control plane is a different host entirely,
 * where that number belongs to some unrelated process. Liveness comes from
 * worker heartbeats, and stopping a desk worker is a message to the desk.
 */
export class DeskRuntime implements ExecutionRuntime {
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
    _hooks?: RuntimeHooks,
  ): Promise<RuntimeHandle | null> {
    return {
      id: lease?.handleId ?? `desk-${runId}`,
      runtime: "desk",
      ip: null,
      pid: lease?.pid ?? null,
    };
  }

  async destroy(_handle: RuntimeHandle): Promise<void> {
    // Intentionally empty. The orchestrator asks the desk to stop its own child.
  }
}
