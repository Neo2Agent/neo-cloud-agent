import type { ExecutionRuntime, RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";

/**
 * P0 runtime: one container per Run.
 * Swap this for Firecracker without changing orchestrator.
 */
export class DockerRuntime implements ExecutionRuntime {
  async provision(spec: RuntimeSpec): Promise<RuntimeHandle> {
    return {
      id: `docker-${spec.runId}`,
      runtime: "docker",
      ip: null,
    };
  }

  async snapshot(handle: RuntimeHandle): Promise<string> {
    return `snap-${handle.id}`;
  }

  async restore(snapshotId: string, spec: RuntimeSpec): Promise<RuntimeHandle> {
    return {
      id: `docker-${spec.runId}-from-${snapshotId}`,
      runtime: "docker",
      ip: null,
    };
  }

  async destroy(_handle: RuntimeHandle): Promise<void> {
    return;
  }
}
