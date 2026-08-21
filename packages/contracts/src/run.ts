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
  | null;

export type RunSource =
  | "web"
  | "cli"
  | "slack"
  | "github"
  | "api"
  | "automation";

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
  model: string;
  prompt: string;
  branchName: string | null;
  repoUrls: string[];
  workerHandle: string | null;
  createdAt: string;
  updatedAt: string;
  idleAt: string | null;
  expiresAt: string | null;
  errorMessage: string | null;
}

export type FollowUpDelivery = "prompt" | "steer" | "follow_up";

export type FollowUpStatus = "queued" | "delivered" | "cancelled";

export interface FollowUp {
  id: string;
  runId: string;
  text: string;
  images?: ImageRef[];
  delivery: FollowUpDelivery;
  status: FollowUpStatus;
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
  model?: string;
  source?: RunSource;
  images?: ImageRef[];
}

export interface CreateFollowUpRequest {
  text: string;
  /** Omit to let the control plane pick prompt vs steer vs follow_up. */
  delivery?: FollowUpDelivery;
  images?: ImageRef[];
}
