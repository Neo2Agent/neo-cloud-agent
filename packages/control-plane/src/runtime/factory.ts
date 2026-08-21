import type { RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import type { WorkerLease } from "../store/persist.js";
import { workerRuntimeKind, type WorkerRuntimeKind } from "../config.js";
import { DockerRuntime, type RuntimeHooks } from "./docker.js";
import { LocalProcessRuntime } from "./local.js";
import { NoneRuntime } from "./none.js";

export interface AgentRuntime {
  provision(spec: RuntimeSpec, hooks?: RuntimeHooks): Promise<RuntimeHandle>;
  destroy(handle: RuntimeHandle): Promise<void>;
  adopt(runId: string, lease: WorkerLease | null, hooks?: RuntimeHooks): Promise<RuntimeHandle | null>;
}

const local = new LocalProcessRuntime();
const docker = new DockerRuntime();
const none = new NoneRuntime();

export function getRuntime(kind: WorkerRuntimeKind = workerRuntimeKind()): AgentRuntime {
  if (kind === "docker") {
    return docker;
  }
  if (kind === "none") {
    return none;
  }
  return local;
}
