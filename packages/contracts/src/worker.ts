import type { FollowUpDelivery, ImageRef } from "./run.js";
import type { RunEvent } from "./events.js";

/** Control plane → VM */
export type WorkerInbound =
  | { type: "prompt"; text: string; images?: ImageRef[] }
  | { type: "steer"; text: string; images?: ImageRef[] }
  | { type: "follow_up"; text: string; images?: ImageRef[] }
  | { type: "abort" }
  | { type: "set_model"; model: string }
  | { type: "shutdown"; reason: "idle" | "archived" | "expired" | "error" };

/** VM → control plane */
export type WorkerOutbound =
  | { type: "register"; runId: string; workerVersion: string }
  | { type: "heartbeat"; runId: string; diskUsedBytes: number; status: "booting" | "ready" | "busy" | "idle" }
  | { type: "events"; runId: string; events: RunEvent[] }
  | { type: "need_llm_token" }
  | { type: "need_git_token"; repoUrl: string; scope: "clone" | "push" }
  | { type: "open_pull_request"; repoUrl: string; branch: string; title: string; body: string }
  | { type: "upload_artifact"; name: string; contentType: string; sizeBytes: number };

export type RuntimeKind = "local" | "docker" | "none" | "firecracker" | "cloud-hypervisor";

export interface RuntimeSpec {
  runId: string;
  image: string;
  snapshotId: string | null;
  cpu: number;
  memoryMiB: number;
  diskGiB: number;
  egress: {
    mode: "allow_all" | "default_plus_allowlist" | "allowlist_only";
    domains: string[];
  };
  jwt: string;
  model: string;
  hostWorkspaceDir: string;
  workspaceMount: string;
  controlPlaneUrl: string;
  llmGatewayUrl: string;
  /** Host path bind-mounted into the worker when using Docker. */
  hostWorkspaceBind?: string;
  dockerNetwork?: string | null;
  /** Override the image CMD (tests / stub workers). */
  command?: string[];
}

export interface RuntimeHandle {
  id: string;
  runtime: RuntimeKind;
  ip: string | null;
}

export interface ExecutionRuntime {
  provision(spec: RuntimeSpec): Promise<RuntimeHandle>;
  snapshot(handle: RuntimeHandle): Promise<string>;
  restore(snapshotId: string, spec: RuntimeSpec): Promise<RuntimeHandle>;
  destroy(handle: RuntimeHandle): Promise<void>;
}

/** How a follow-up should be handed to pi-coding-agent. */
export function deliveryForPi(delivery: FollowUpDelivery): "prompt" | "steer" | "followUp" {
  if (delivery === "follow_up") return "followUp";
  return delivery;
}
