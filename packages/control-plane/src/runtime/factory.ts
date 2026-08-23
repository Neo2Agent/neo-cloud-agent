import type { RuntimeHandle, RuntimeSpec } from "@neo-cloud-agent/contracts";
import type { WorkerLease } from "../store/persist.js";
import { workerRuntimeKind, type WorkerRuntimeKind } from "../config.js";
import { DockerRuntime, type RuntimeHooks } from "./docker.js";
import { FirecrackerRuntime } from "./firecracker.js";
import { LocalProcessRuntime } from "./local.js";
import { NoneRuntime } from "./none.js";
import { DeskRuntime } from "./desk.js";
import { VmSlotRuntime } from "./vm.js";

export interface AgentRuntime {
  provision(spec: RuntimeSpec, hooks?: RuntimeHooks): Promise<RuntimeHandle>;
  destroy(handle: RuntimeHandle): Promise<void>;
  adopt(runId: string, lease: WorkerLease | null, hooks?: RuntimeHooks): Promise<RuntimeHandle | null>;
}

const local = new LocalProcessRuntime();
const docker = new DockerRuntime();
const none = new NoneRuntime();
const firecracker = new FirecrackerRuntime();
const vm = new VmSlotRuntime();
const desk = new DeskRuntime();
let override: AgentRuntime | undefined;

export function setRuntimeForTests(next?: AgentRuntime): void {
  override = next;
}

export function getRuntime(kind: WorkerRuntimeKind = workerRuntimeKind()): AgentRuntime {
  if (override) {
    return override;
  }
  if (kind === "docker") {
    return docker;
  }
  if (kind === "none") {
    return none;
  }
  if (kind === "firecracker") {
    return firecracker;
  }
  if (kind === "vm") {
    return vm;
  }
  if (kind === "desk") {
    return desk;
  }
  return local;
}
