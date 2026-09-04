import type { FollowUpDelivery, ImageRef } from "./run.js";

export type LoopDelivery = FollowUpDelivery;

export type TurnCompleteStatus = "idle" | "error" | "waiting_for_background";

export type TurnSignalType = "abort" | "steer";

export interface LoopWorkspaceContext {
  agentsMd?: string;
  expertMd?: string;
  skillRoots?: string[];
  systemPromptExtra?: string;
}

export interface LoopToolsBinding {
  mode: "worker_ws";
  url: string;
  leaseId?: string;
  sandboxRoot: string;
}

export interface StartTurnRequest {
  runId: string;
  turnId: string;
  orgId: string;
  userId: string;
  delivery: LoopDelivery;
  text: string;
  images?: ImageRef[];
  model: string;
  jwt: string;
  llmGatewayUrl: string;
  controlPlaneUrl: string;
  tools: LoopToolsBinding;
  workspace?: LoopWorkspaceContext;
  toolAllowlist?: string[];
  followUpId?: string | null;
}

export interface StartTurnResponse {
  turnId: string;
  runId: string;
  accepted: boolean;
}

export interface TurnSignalRequest {
  type: TurnSignalType;
  text?: string;
  followUpId?: string;
}

export interface TurnSnapshot {
  turnId: string;
  runId: string;
  phase: "ensure" | "restore" | "infer" | "tool" | "persist" | "done" | "aborted";
  stepId?: string;
  startedAt: string;
}

export interface TurnCompleteRequest {
  turnId: string;
  status: TurnCompleteStatus;
  errorMessage?: string | null;
  usage?: { inputTokens: number; outputTokens: number };
  cancelled?: boolean;
}

export interface TurnHeartbeatRequest {
  turnId: string;
  phase: TurnSnapshot["phase"];
  stepId?: string;
}
