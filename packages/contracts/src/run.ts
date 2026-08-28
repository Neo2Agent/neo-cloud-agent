/** Lifecycle of one cloud-agent execution. */
export type RunStatus =
  | "NOT_YET_STARTED"
  | "PROVISIONING"
  | "INSTALLING"
  | "RUNNING"
  | "IDLE"
  | "WAITING_FOR_BACKGROUND_WORK"
  | "ERROR"
  | "ARCHIVED"
  | "EXPIRED";

export type SetupStatus =
  | "INSTALL_STARTED"
  | "INSTALL_SUCCEEDED"
  | "INSTALL_FAILED"
  | "START_STARTED"
  | "START_SUCCEEDED"
  | "START_FAILED"
  | null;

export type RunSource =
  | "web"
  | "cli"
  | "slack"
  | "github"
  | "api"
  | "automation"
  | "telegram"
  | "wechat"
  | "desk"
  | "ios"
  | "android";

export const RUN_SOURCES: readonly RunSource[] = [
  "web",
  "cli",
  "slack",
  "github",
  "api",
  "automation",
  "telegram",
  "wechat",
  "desk",
  "ios",
  "android",
];

export function parseRunSource(value: unknown): RunSource | undefined {
  return typeof value === "string" && (RUN_SOURCES as readonly string[]).includes(value)
    ? (value as RunSource)
    : undefined;
}

export type ExecutionPlace = "cloud" | "desk";

/**
 * Two axes so a later "cloud loop + desk tools" combo does not rewrite the contract.
 * P0–P2 only allow `loop === tools`.
 */
export interface ExecutionTarget {
  loop: ExecutionPlace;
  tools: ExecutionPlace;
  deskId?: string;
  /** Which bound workspace on that desk runs this. Absolute path stays local. */
  deskWorkspaceId?: string;
  /**
   * This Computer omits this. Remote Control sets it so web/phone can list the
   * same local run. Older desk runs without the field stay private.
   */
  remoteControl?: boolean;
}

export type AgentMode = "agent" | "ask";

/**
 * Who starts the worker for a desk target.
 * `inline`: the caller is that desk, so it spawns right after the response.
 * `dispatch`: someone else asked this desk to run it, so the desk is notified.
 */
export type RunStart = "inline" | "dispatch";

export function parseRunStart(value: unknown): RunStart | undefined {
  return value === "inline" || value === "dispatch" ? value : undefined;
}

export function parseExecutionTarget(value: unknown): ExecutionTarget | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const loop = record.loop === "desk" || record.loop === "cloud" ? record.loop : null;
  const tools = record.tools === "desk" || record.tools === "cloud" ? record.tools : null;
  if (!loop || !tools) {
    return undefined;
  }
  const deskId = typeof record.deskId === "string" && record.deskId.trim() ? record.deskId.trim() : undefined;
  const deskWorkspaceId =
    typeof record.deskWorkspaceId === "string" && record.deskWorkspaceId.trim() ? record.deskWorkspaceId.trim() : undefined;
  const remoteControl = loop === "desk" && record.remoteControl === true;
  return { loop, tools, deskId, deskWorkspaceId, ...(remoteControl ? { remoteControl: true } : {}) };
}

export function colocatedTarget(place: ExecutionPlace, deskId?: string): ExecutionTarget {
  return place === "desk" ? { loop: "desk", tools: "desk", deskId } : { loop: "cloud", tools: "cloud" };
}

export function assertColocatedTarget(target: ExecutionTarget): void {
  if (target.loop !== target.tools) {
    throw new Error("P0–P2 只允许 loop 与 tools 同址");
  }
  if (target.tools === "desk" && !target.deskId) {
    throw new Error("本机执行需要 deskId");
  }
}

export function isDeskTarget(
  target?: ExecutionTarget | null,
): target is ExecutionTarget & { loop: "desk"; tools: "desk" } {
  return target?.loop === "desk" && target.tools === "desk";
}

export function isRemoteControlTarget(target?: ExecutionTarget | null): boolean {
  return isDeskTarget(target) && target.remoteControl === true;
}

export interface Run {
  id: string;
  orgId: string;
  userId: string;
  envId: string | null;
  envVersionId: string | null;
  buildId: string | null;
  status: RunStatus;
  setupStatus: SetupStatus;
  source: RunSource;
  projectId?: string | null;
  assigneeUserId?: string | null;
  collaborators?: RunCollaborator[];
  todoId?: string | null;
  expertId?: string | null;
  expertTeamId?: string | null;
  executionTarget?: ExecutionTarget | null;
  model: string;
  prompt: string;
  branchName: string | null;
  baseBranch: string | null;
  repoUrls: string[];
  pullRequests: PullRequestRef[];
  workerHandle: string | null;
  /** Firecracker / loop VM slot claimed for this run, e.g. slot-0. */
  vmSlotId?: string | null;
  createdAt: string;
  updatedAt: string;
  idleAt: string | null;
  expiresAt: string | null;
  errorMessage: string | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  /** Telegram chat that started this run; completion notify prefers it. */
  notifyChatId?: string | null;
  /** Human push on the run branch disables further CI autofix. */
  blockAutofix?: boolean;
  /** Latest model-context fill. Not cumulative billed tokens. */
  contextUsage?: {
    tokens: number;
    contextWindow: number | null;
    percent: number | null;
    source: "session" | "estimate";
    model?: string;
    buckets: Array<{ id: string; label: string; tokens: number }>;
  } | null;
}

export interface PullRequestRef {
  repoUrl: string;
  branch: string;
  url: string;
  draft: boolean;
  number: number | null;
  title: string;
}

export type FollowUpDelivery = "prompt" | "steer" | "follow_up";

export type FollowUpStatus = "queued" | "delivered" | "cancelled";

export type FollowUpSource = "user" | "subscription" | "autofix";

export type RunCollaboratorRole = "host" | "editor";

export type RunCollaborator = {
  userId: string;
  email: string;
  role: RunCollaboratorRole;
  joinedAt: string;
};

export type TransferRunMode = "reassign" | "fork";

export type TransferRunRequest = {
  toUserId: string;
  note?: string;
  mode?: TransferRunMode;
};

export type ProjectRunCard = {
  id: string;
  title: string;
  status: RunStatus;
  projectId: string;
  hostUserId: string;
  hostEmail: string;
  loop: ExecutionPlace;
  updatedAt: string;
  role: RunCollaboratorRole | null;
};

export interface FollowUp {
  id: string;
  runId: string;
  text: string;
  images?: ImageRef[];
  delivery: FollowUpDelivery;
  status: FollowUpStatus;
  source?: FollowUpSource;
  actorUserId?: string;
  actorEmail?: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface ImageRef {
  mediaType: string;
  /** Base64 payload or object-store key. */
  data: string;
}

export interface CreateRunRequest {
  prompt: string;
  repoUrls: string[];
  ref?: string;
  envId?: string;
  buildId?: string;
  /** When false, skip restoring an active build and cold-install. Default true. */
  reuseBuild?: boolean;
  model?: string;
  source?: RunSource;
  projectId?: string;
  todoId?: string;
  expertId?: string;
  expertTeamId?: string;
  images?: ImageRef[];
  notifyChatId?: string;
  target?: ExecutionTarget;
  /** Desk targets only. Default `dispatch`. */
  start?: RunStart;
  /** Desk targets only. Which bound workspace on that desk should run this. */
  deskWorkspaceId?: string;
  mode?: AgentMode;
}

export interface CreateFollowUpRequest {
  text: string;
  /** Omit to let the control plane pick prompt vs steer vs follow_up. */
  delivery?: FollowUpDelivery;
  images?: ImageRef[];
  source?: FollowUpSource;
}

export interface CreateCommitRequest {
  message: string;
  paths?: string[];
}

export interface CreatePullRequestRequest {
  title: string;
  body?: string;
  remoteUrl?: string;
}

export type GitTokenScope = "clone" | "push";

export interface CreateGitTokenRequest {
  repoUrl?: string;
  scope: GitTokenScope;
}
