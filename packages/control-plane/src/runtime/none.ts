import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import type { RuntimeHooks } from "./docker.js";

/** Test / API-only mode: reserve a handle, do not start a worker. */
export class NoneRuntime implements ExecutionRuntime {
  async provision(spec: RuntimeSpec, _hooks?: RuntimeHooks): Promise<RuntimeHandle> {
    return { id: `none-${spec.runId}`, runtime: "none", ip: null };
  }

  async snapshot(handle: RuntimeHandle): Promise<string> {
    return `snap-${handle.id}`;
  }

  async restore(snapshotId: string, spec: RuntimeSpec): Promise<RuntimeHandle> {
    return { id: `none-${spec.runId}-from-${snapshotId}`, runtime: "none", ip: null };
  }

  async destroy(_handle: RuntimeHandle): Promise<void> {}

  async adopt(runId: string, lease?: { handleId?: string } | null): Promise<RuntimeHandle> {
    return { id: lease?.handleId ?? `none-${runId}`, runtime: "none", ip: null };
  }
}
