import { defaultAgentKernel, parseAgentKernel, type AgentKernel, type KernelEnv } from "./kernel.js";

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

export type { AgentKernel } from "./kernel.js";

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
  const remoteControl = tools === "desk" && record.remoteControl === true;
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

/**
 * Agentscope kernel may split loop/tools. Desk loop + cloud tools is still forbidden.
 */
export function assertExecutionTarget(target: ExecutionTarget, kernel: AgentKernel = "pi"): void {
  if (target.tools === "desk" && !target.deskId) {
    throw new Error("本机执行需要 deskId");
  }
  if (target.loop === "desk" && target.tools === "cloud") {
    throw new Error("不支持本机 loop + 云端工具");
  }
  if (kernel === "pi") {
    assertColocatedTarget(target);
  }
}

export function isDeskTarget(
  target?: ExecutionTarget | null,
): target is ExecutionTarget & { loop: "desk"; tools: "desk" } {
  return target?.loop === "desk" && target.tools === "desk";
}

export function isDeskToolsTarget(
  target?: ExecutionTarget | null,
): target is ExecutionTarget & { tools: "desk"; deskId: string } {
  return target?.tools === "desk" && Boolean(target.deskId);
}

export function isCloudLoopTarget(target?: ExecutionTarget | null): boolean {
  return (target?.loop ?? "cloud") === "cloud";
}

/**
 * Cursor Remote / My Machines: cloud loop + desk tools.
 * This Computer is `{loop:desk, tools:desk}` and is not Remote, even if an
 * older run set `remoteControl` so the web could list it.
 */
export function isRemoteControlTarget(
  target?: ExecutionTarget | null,
): target is ExecutionTarget & { loop: "cloud"; tools: "desk"; deskId: string; remoteControl: true } {
  return Boolean(
    target?.remoteControl && target.loop === "cloud" && target.tools === "desk" && target.deskId,
  );
}

export type RunMode = "cloud" | "remote" | "local";

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  cloud: "云端",
  remote: "Remote Control",
  local: "This Computer",
};

/** Run-list tags, where the full name does not fit. */
export const RUN_MODE_SHORT_LABELS: Record<RunMode, string> = {
  cloud: "云端",
  remote: "Remote",
  local: "本机",
};

/** Where a run executes, named the same on every client. */
export function runMode(target?: ExecutionTarget | null): RunMode {
  if (isDeskTarget(target)) return "local";
  if (isDeskToolsTarget(target)) return "remote";
  return "cloud";
}

/**
 * Cursor-shaped kernel pick. Explicit `kernel` always wins.
 * This Computer stays colocated pi. Remote needs agentscope.
 * Cloud uses agentscope when neo-loop is healthy, else AGENT_KERNEL / pi.
 */
export function resolveRunKernel(
  input: { kernel?: unknown; target?: ExecutionTarget | null },
  env: KernelEnv = {},
): AgentKernel {
  const requested = parseAgentKernel(input.kernel);
  if (requested) {
    return requested;
  }
  if (isDeskTarget(input.target)) {
    return "pi";
  }
  if (isRemoteControlTarget(input.target)) {
    return "agentscope";
  }
  if (env.NEO_LOOP_AVAILABLE === "1" || env.NEO_LOOP_AVAILABLE === "true") {
    return "agentscope";
  }
  return defaultAgentKernel(env);
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
  plugins?: Array<{ slug: string; version: string; digest: string }>;
  executionTarget?: ExecutionTarget | null;
  /** pi = loop in worker; agentscope = loop in neo-loop. Default pi. */
  kernel?: AgentKernel;
  /** Active Java turn, if kernel=agentscope. */
  currentTurnId?: string | null;
  model: string;
  prompt: string;
  /**
   * Sidebar title. Create writes the first prompt line when omitted.
   * Later changes only happen through PATCH (manual or explicit generate).
   */
  title?: string | null;
  branchName: string | null;
  baseBranch: string | null;
  repoUrls: string[];
  pullRequests: PullRequestRef[];
  /** Commits made through `/commit`, newest last. Capped; the workspace log is authoritative while it exists. */
  commits?: RunCommitRef[];
  workerHandle: string | null;
  /** Firecracker / loop VM slot claimed for this run, e.g. slot-0. */
  vmSlotId?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Newest event id, derived per response and never persisted. Lets a poller
   * tell "nothing happened" from "new tokens" without pulling the transcript.
   */
  lastEventId?: string | null;
  idleAt: string | null;
  expiresAt: string | null;
  /** MySQL/file soft-delete. Hidden from lists once set. */
  deletedAt?: string | null;
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
    buckets: Array<{
      id: string;
      label: string;
      tokens: number;
      children?: Array<{ id: string; label: string; tokens: number }>;
    }>;
  } | null;
}

/**
 * List label source: the stored title when set, else the prompt.
 * Not truncated; each client applies its own width.
 */
export function runDisplayTitle(run: { title?: string | null; prompt?: string | null }): string {
  return (run.title ?? "").trim() || (run.prompt ?? "").trim();
}

export type PullRequestState = "open" | "closed" | "merged";

export interface PullRequestChecks {
  passed: number;
  failed: number;
  pending: number;
}

export interface PullRequestRef {
  repoUrl: string;
  branch: string;
  url: string;
  draft: boolean;
  number: number | null;
  title: string;
  /** Filled from GitHub (API refresh or `pull_request` webhook). Absent for `local://pr`. */
  state?: PullRequestState;
  mergedAt?: string | null;
  baseBranch?: string | null;
  headSha?: string | null;
  checks?: PullRequestChecks | null;
  /** GitHub compare stats; absent until refresh. */
  additions?: number | null;
  deletions?: number | null;
  /** When state / checks were last read from GitHub. */
  updatedAt?: string | null;
}

/** A commit this run made, recorded so the list survives the workspace being reclaimed. */
export interface RunCommitRef {
  sha: string;
  message: string;
  author: string;
  authoredAt: string;
  added: number;
  removed: number;
  files: number;
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
  /** Optional sidebar title. Empty/whitespace falls back to the prompt line. */
  title?: string;
  repoUrls: string[];
  /** When true, do not fill empty repoUrls from the project or environment. */
  skipRepoDefaults?: boolean;
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
  pluginIds?: string[];
  images?: ImageRef[];
  notifyChatId?: string;
  target?: ExecutionTarget;
  kernel?: AgentKernel;
  /** Desk targets only. Default `dispatch`. */
  start?: RunStart;
  /** Desk targets only. Which bound workspace on that desk should run this. */
  deskWorkspaceId?: string;
  mode?: AgentMode;
}

export type PatchRunRequest = {
  /** Empty or null clears the stored title so the prompt is shown again. */
  title?: string | null;
  /** Explicit LLM rename. Overwrites a non-empty title. */
  generate?: boolean;
};

export function parsePatchRunRequest(body: unknown): PatchRunRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("title or generate is required");
  }
  const raw = body as Record<string, unknown>;
  const hasTitle = Object.prototype.hasOwnProperty.call(raw, "title");
  const hasGenerate = Object.prototype.hasOwnProperty.call(raw, "generate");
  if (!hasTitle && !hasGenerate) {
    throw new Error("title or generate is required");
  }
  const out: PatchRunRequest = {};
  if (hasTitle) {
    if (raw.title !== null && typeof raw.title !== "string") {
      throw new Error("title must be a string or null");
    }
    out.title = raw.title;
  }
  if (hasGenerate) {
    if (typeof raw.generate !== "boolean") {
      throw new Error("generate must be a boolean");
    }
    out.generate = raw.generate;
  }
  if (out.title === undefined && out.generate !== true) {
    throw new Error("title or generate is required");
  }
  return out;
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
