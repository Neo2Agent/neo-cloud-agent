import type { ExecutionTarget } from "./run.js";

/**
 * One folder this desk agreed to run agents in. The absolute path stays on the
 * machine; the control plane only keeps an identity other clients can pick.
 */
export interface DeskWorkspace {
  id: string;
  /** Folder short name, shown as `machine · name`. */
  name: string;
  /** Normalized git remote when the folder is a repo, else `local:<name>`. */
  repoKey: string;
  /** True when the folder has a .git dir, so commit / PR tools work. */
  git: boolean;
  boundAt: string;
}

export interface Desk {
  id: string;
  userId: string;
  orgId: string;
  name: string;
  hostname: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  online: boolean;
  /** Folders this desk will run agents in. Empty means local runs are not set up yet. */
  workspaces?: DeskWorkspace[];
  /** False hides this desk from other clients, so only inline runs work. */
  allowRemote?: boolean;
}

export interface CreateDeskRequest {
  name?: string;
  hostname?: string;
  platform?: string;
}

export interface BindDeskWorkspaceRequest {
  name: string;
  repoKey: string;
  git?: boolean;
}

export interface UpdateDeskRequest {
  name?: string;
  allowRemote?: boolean;
}

export interface DeskAssignment {
  runId: string;
  jwt: string;
  model: string;
  prompt: string;
  repoUrls: string[];
  controlPlaneUrl: string;
  llmGatewayUrl: string;
  target: ExecutionTarget;
  /** Which bound workspace the desk should run this in. */
  workspaceId?: string | null;
  /** Who asked for this run, so the desk can name it in the notification. */
  requestedBy?: string | null;
  expertId?: string | null;
  expertTeamId?: string | null;
  expertMarkdown?: string;
  expertTeamMarkdown?: string;
  expertMeta?: string;
  expertAgents?: Array<{ slug: string; markdown: string }>;
  pluginSkills?: Array<{ slug: string; files: Array<{ relativePath: string; content: string }> }>;
  pluginSnapshot?: string;
}

export interface DeskLeaseResponse {
  assignment: DeskAssignment | null;
}

export interface DeskClaimRequest {
  runId: string;
  workspaceDir: string;
  pid?: number;
}

export interface DeskRejectRequest {
  runId: string;
  reason?: string;
}

/** Pushed down the desk inbox stream so the control plane never dials in. */
export type DeskInboxEvent =
  | { kind: "assignment"; assignment: DeskAssignment }
  | { kind: "cancel"; runId: string; reason?: string }
  | { kind: "ping" };

export interface HandoffRequest {
  target: ExecutionTarget;
  /** Desk targets only. Which bound workspace should pick this up. */
  deskWorkspaceId?: string;
}

export const DESK_HOST_OFFLINE_MESSAGE = "发起这条对话的 Desk 离线。打开 Desk 后才能继续。";
export const DESK_HOST_UNBOUND_MESSAGE = "这条本机对话还没有绑定电脑，打开 Desk 后才能继续。";

export type RemoteControlSendLockOptions = {
  /** The Desk window that started this run may send even if the list is stale. */
  thisDeskId?: string | null;
};

/** Other clients may send only while the desk that started this run still holds its inbox. */
export function remoteControlSendLock(
  run: { executionTarget?: { loop?: string; deskId?: string | null } | null } | null | undefined,
  desks: Array<Pick<Desk, "id" | "online">>,
  options?: RemoteControlSendLockOptions,
): { locked: boolean; hint: string } {
  if (run?.executionTarget?.loop !== "desk") {
    return { locked: false, hint: "" };
  }
  const deskId = run.executionTarget.deskId?.trim();
  if (!deskId) {
    return { locked: true, hint: DESK_HOST_UNBOUND_MESSAGE };
  }
  if (options?.thisDeskId?.trim() === deskId) {
    return { locked: false, hint: "" };
  }
  const host = desks.find((item) => item.id === deskId);
  if (host?.online === true) {
    return { locked: false, hint: "" };
  }
  return { locked: true, hint: DESK_HOST_OFFLINE_MESSAGE };
}
