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
  | "wechat";

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

export interface FollowUp {
  id: string;
  runId: string;
  text: string;
  images?: ImageRef[];
  delivery: FollowUpDelivery;
  status: FollowUpStatus;
  source?: FollowUpSource;
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
  images?: ImageRef[];
  notifyChatId?: string;
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
