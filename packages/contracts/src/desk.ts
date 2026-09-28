import type { ExecutionTarget } from "./run.js";
import { isRemoteControlTarget } from "./run.js";
import { runCloneBranch, runCloneRemoteUrl, shortCloneRepo } from "./git.js";

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
  kernel?: "pi" | "agentscope";
  /** Loopback-only. Packaged Desk must use `toolsChannelUrl` instead of `:8082`. */
  neoLoopUrl?: string;
  neoLoopToken?: string;
  /** Control-plane WSS proxy: `/v1/desks/:id/tools/:runId`. */
  toolsChannelUrl?: string;
}

export interface DeskLeaseResponse {
  assignment: DeskAssignment | null;
}

export interface DeskClaimRequest {
  runId: string;
  workspaceDir: string;
  pid?: number;
  /** Laptop `origin` so an offline Remote can clone in the cloud. */
  remoteUrl?: string;
  /** Current branch on that laptop. */
  branch?: string;
}

export interface DeskRejectRequest {
  runId: string;
  reason?: string;
}

/** Pushed down the desk inbox stream so the control plane never dials in. */
export type DeskInboxEvent =
  | { kind: "assignment"; assignment: DeskAssignment }
  | { kind: "cancel"; runId: string; reason?: string }
  /**
   * The control plane cannot read this laptop's disk; ask the Desk to report the run's git state.
   * `since` is when the run started; `workspaceId` / `folder` locate it once its worker is gone.
   */
  | { kind: "git_snapshot"; runId: string; since?: string; workspaceId?: string; folder?: string }
  | { kind: "ping" };

export interface HandoffRequest {
  target: ExecutionTarget;
  /** Desk targets only. Which bound workspace should pick this up. */
  deskWorkspaceId?: string;
}

export const DESK_HOST_OFFLINE_MESSAGE = "发起这条对话的 Desk 离线。打开 Desk 后才能继续。";
export const DESK_HOST_UNBOUND_MESSAGE = "这条本机对话还没有绑定电脑，打开 Desk 后才能继续。";

type RemoteControlSendLockOptions = {
  /** The Desk window that started this run may send even if the list is stale. */
  thisDeskId?: string | null;
};

/** Tools or loop live on a laptop. Offline desk must fail closed — including cloud-loop Remote. */
export function isDeskHostedTarget<T extends { loop?: string; tools?: string }>(
  target?: T | null,
): target is T {
  return target?.tools === "desk" || target?.loop === "desk";
}

/** Other clients may send only while the desk that started this run still holds its inbox. */
export function remoteControlSendLock(
  run: {
    executionTarget?: { loop?: string; tools?: string; deskId?: string | null; remoteControl?: boolean } | null;
  } | null | undefined,
  desks: Array<Pick<Desk, "id" | "online">>,
  options?: RemoteControlSendLockOptions,
): { locked: boolean; hint: string } {
  const target = run?.executionTarget;
  if (!isDeskHostedTarget(target)) {
    return { locked: false, hint: "" };
  }
  const deskId = target.deskId?.trim();
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

export const REMOTE_CLOUD_CONTINUE_ONLINE = "电脑在线时请在这条 Remote 上继续。";
export const REMOTE_CLOUD_CONTINUE_NO_REMOTE =
  "这条 Remote 没有可 clone 的远端仓库。未 push 的改动也不会上去。";
export const REMOTE_CLOUD_CONTINUE_HINT = "未 push 的本机改动不会上去。云端按已记录的仓库和分支继续这条对话。";
export const REMOTE_CLOUD_CONTINUE_TITLE = "Desk 离线";
export const REMOTE_CLOUD_CONTINUE_BODY = "同一条对话转到云端继续。";
export const REMOTE_CLOUD_CONTINUE_ACTION = "在云端继续这条对话";
export const REMOTE_CLOUD_CONTINUE_STATUS = "Desk 离线";
export const REMOTE_CLOUD_CONTINUE_COMPOSER = "Desk 离线，发送已锁定。";
export const REMOTE_CLOUD_CONTINUE_WARNING = "未 push 的本机改动不会上去。";

export type RemoteCloudContinueOffer = {
  show: boolean;
  remoteUrl: string;
  branch: string;
};

export type RemoteCloudContinueCopy = {
  title: string;
  body: string;
  repoLine: string;
  warning: string;
  action: string;
  confirmTitle: string;
  confirmMessage: string;
  confirmAction: string;
  composerHint: string;
  status: string;
};

/** Shared Web / Mobile copy for the offline Remote → cloud card. */
export function remoteCloudContinueCopy(
  offer: Pick<RemoteCloudContinueOffer, "remoteUrl" | "branch">,
): RemoteCloudContinueCopy {
  const repo = shortCloneRepo(offer.remoteUrl);
  const repoLine = [repo, offer.branch].filter(Boolean).join(" · ");
  return {
    title: REMOTE_CLOUD_CONTINUE_TITLE,
    body: REMOTE_CLOUD_CONTINUE_BODY,
    repoLine,
    warning: REMOTE_CLOUD_CONTINUE_WARNING,
    action: REMOTE_CLOUD_CONTINUE_ACTION,
    confirmTitle: "在云端继续这条对话？",
    confirmMessage: repoLine
      ? `云端会按 ${repoLine} clone 后继续这条对话。未 push 的本机改动不会上去。`
      : REMOTE_CLOUD_CONTINUE_HINT,
    confirmAction: "在云端续聊",
    composerHint: REMOTE_CLOUD_CONTINUE_COMPOSER,
    status: REMOTE_CLOUD_CONTINUE_STATUS,
  };
}

/**
 * Offer "continue this Remote in the cloud" only when the host is offline and
 * we already recorded a cloneable origin. This Computer never qualifies.
 */
export function remoteCloudContinueOffer(
  run: {
    status?: string | null;
    remoteUrl?: string | null;
    repoUrls?: string[] | null;
    branchName?: string | null;
    baseBranch?: string | null;
    executionTarget?: ExecutionTarget | null;
  } | null | undefined,
  desks: Array<Pick<Desk, "id" | "online">>,
  options?: RemoteControlSendLockOptions,
): RemoteCloudContinueOffer {
  if (!run || !isRemoteControlTarget(run.executionTarget)) {
    return { show: false, remoteUrl: "", branch: "" };
  }
  if (run.status === "ARCHIVED" || run.status === "EXPIRED") {
    return { show: false, remoteUrl: "", branch: "" };
  }
  if (!remoteControlSendLock(run, desks, options).locked) {
    return { show: false, remoteUrl: "", branch: "" };
  }
  const remoteUrl = runCloneRemoteUrl(run) ?? "";
  const branch = runCloneBranch(run) ?? "";
  return { show: Boolean(remoteUrl), remoteUrl, branch };
}

export function remoteCloudHandoffRepoLine(input?: {
  remoteUrl?: string | null;
  repoUrls?: string[] | null;
  baseBranch?: string | null;
  branchName?: string | null;
  ref?: string | null;
}): string {
  const repo = shortCloneRepo(runCloneRemoteUrl(input ?? {}) ?? "");
  const branch = runCloneBranch(input ?? {}) ?? (input?.ref ?? "").trim();
  return [repo, branch].filter(Boolean).join(" · ");
}

export function remoteCloudHandoffCloneStarted(repoLine = ""): string {
  return repoLine ? `正在按 ${repoLine} 在云端物化工作区` : "正在按已记录的仓库和分支在云端物化工作区";
}

export function remoteCloudHandoffCloneReady(repoLine = ""): string {
  return repoLine
    ? `已转到云端 · 工作区就绪 · ${repoLine} · 未 push 的本机改动没有上去`
    : "已转到云端 · 工作区就绪 · 未 push 的本机改动没有上去";
}

function looksHandoffCloneStart(text: string): boolean {
  return /Handoff:\s*cloning|cloning clean remote|在云端物化工作区/i.test(text);
}

function looksHandoffCloneReady(text: string): boolean {
  return /Handoff workspace ready|^Workspace ready on |已转到云端/i.test(text);
}

/** Setup line for a Remote → cloud handoff; other setup text is unchanged. */
export function displaySetupText(
  message: { kind?: string | null; text?: string | null },
  run?: {
    remoteUrl?: string | null;
    repoUrls?: string[] | null;
    baseBranch?: string | null;
    branchName?: string | null;
  } | null,
): string {
  const text = message.text ?? "";
  const fromReady = /^Workspace ready on (.+)$/.exec(text);
  const repoLine = remoteCloudHandoffRepoLine({
    ...run,
    ref: fromReady?.[1] ?? runCloneBranch(run ?? {}) ?? "",
  });
  if (message.kind === "scm.clone_started" && looksHandoffCloneStart(text)) {
    return remoteCloudHandoffCloneStarted(repoLine);
  }
  if (message.kind === "scm.clone_succeeded" && looksHandoffCloneReady(text)) {
    return remoteCloudHandoffCloneReady(repoLine);
  }
  if (!message.kind && looksHandoffCloneStart(text)) {
    return remoteCloudHandoffCloneStarted(repoLine);
  }
  if (!message.kind && looksHandoffCloneReady(text)) {
    return remoteCloudHandoffCloneReady(repoLine);
  }
  return text;
}
