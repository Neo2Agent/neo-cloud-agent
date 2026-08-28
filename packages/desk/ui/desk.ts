import type { DeskAssignment } from "@neo-cloud-agent/contracts/desk";

export const TARGET_CLOUD = "cloud" as const;
export const TARGET_DESK = "desk" as const;
export const TARGET_REMOTE = "remote" as const;
export const DESK_CLIENT_QUERY = "desk";

export type DeskTargetKind = typeof TARGET_CLOUD | typeof TARGET_DESK | typeof TARGET_REMOTE;

export type DeskTarget = {
  kind: DeskTargetKind;
  folder?: string;
  deskId?: string;
  workspaceId?: string;
};

export function isLocalDeskKind(kind?: DeskTargetKind | null): boolean {
  return kind === TARGET_DESK || kind === TARGET_REMOTE;
}

export function isRemoteControlRun(
  run?: { executionTarget?: { loop?: string; remoteControl?: boolean } | null } | null,
): boolean {
  return run?.executionTarget?.loop === "desk" && run.executionTarget.remoteControl === true;
}

export function localRunLabel(
  run?: { executionTarget?: { loop?: string; remoteControl?: boolean } | null } | null,
): string {
  return isRemoteControlRun(run) ? "Remote Control" : "This Computer";
}

/** Keep the live desk id when the UI only changes folder / kind. */
export function mergeDeskTarget(target: DeskTarget, deskId?: string): DeskTarget {
  const id = (deskId || target.deskId || "").trim();
  return id ? { ...target, deskId: id } : { ...target, deskId: undefined };
}

/** Local ids stay on this machine. Remote Control only adds the visibility flag. */
export function localRunTarget(
  target: DeskTarget,
  deskId?: string,
): {
  loop: "desk";
  tools: "desk";
  deskId?: string;
  remoteControl?: true;
} {
  const merged = mergeDeskTarget(target, deskId);
  return {
    loop: "desk",
    tools: "desk",
    deskId: merged.deskId,
    ...(merged.kind === TARGET_REMOTE ? { remoteControl: true as const } : {}),
  };
}

export const MISSING_DESK_ID_HINT = "本机还没登记到控制面。等连上后再发，或退出重新登录。";

/**
 * The folder a local run works in.
 *
 * Runs are created with their folder as the only repo url, so the run itself is
 * the answer. Reading the picker instead would follow whatever is selected now,
 * which is the wrong folder as soon as two local runs are open.
 */
export function localRunFolder(run?: { executionTarget?: { loop?: string } | null; repoUrls?: string[] } | null): string {
  if (run?.executionTarget?.loop !== "desk") {
    return "";
  }
  return run.repoUrls?.[0] ?? "";
}

export type DeskWorkspaceRef = {
  id: string;
  folder: string;
  name: string;
  git: boolean;
};

export type DeskRunStatus = {
  runId: string;
  state: "starting" | "running" | "failed" | "stopped";
  detail?: string;
  workspace?: string;
  /** Worth telling the user without failing the run, like a shared folder. */
  notice?: string;
};

export type LocalFsEntry = { name: string; path: string; type: "file" | "dir"; size?: number };

export type LocalFsListing = {
  root: string;
  path: string;
  type: "file" | "dir";
  entries?: LocalFsEntry[];
  content?: string;
  truncated?: boolean;
  error?: string;
};

/**
 * The preload bridge. Everything added after the first release is optional:
 * the main process and preload only reload when Electron restarts, so a hot
 * renderer can be talking to an older bridge. Calling a method that is not
 * there would throw inside an effect and blank the window, so every new call
 * has to tolerate a missing one.
 */
export type NeoDeskBridge = {
  apiBase: string;
  canRunLocal: boolean;
  /** Packaged Desk talks to production through the main process, not from the renderer. */
  proxyApi?: boolean;
  getToken(): Promise<string>;
  setToken(token: string): Promise<{ deskId?: string; error?: string } | void>;
  clearToken(): Promise<void>;
  pickFolder(): Promise<DeskWorkspaceRef | string | null>;
  getTarget(): Promise<DeskTarget>;
  setTarget(target: DeskTarget): Promise<void>;
  openPath(filePath: string): Promise<void>;
  listWorkspaces?(): Promise<DeskWorkspaceRef[]>;
  unbindWorkspace?(workspaceId: string): Promise<boolean>;
  getPrefs?(): Promise<{
    requireApproval?: boolean;
    maxLocalRuns?: number;
    deskId?: string;
  }>;
  setPrefs?(next: {
    requireApproval?: boolean;
    maxLocalRuns?: number;
  }): Promise<{ requireApproval?: boolean; maxLocalRuns?: number }>;
  /** `folder` pins this run to a folder so parallel runs cannot follow the picker. */
  startRun?(assignment: DeskAssignment, folder?: string): Promise<boolean>;
  takeAssignment?(runId?: string, folder?: string): Promise<{ started?: boolean; runId?: string }>;
  stopRun?(runId: string): Promise<boolean>;
  listDir?(input: { folder: string; path?: string; content?: boolean }): Promise<LocalFsListing>;
  diffStat?(folder: string): Promise<{ added: number; removed: number } | null>;
  termOpen?(folder: string): Promise<{ id?: string; cwd?: string; error?: string }>;
  termWrite?(id: string, data: string): Promise<boolean>;
  termClose?(id: string): Promise<boolean>;
  onRunStatus?(cb: (status: DeskRunStatus) => void): () => void;
  onDispatched?(cb: (payload: { runId: string; workspace: string }) => void): () => void;
  onTarget?(cb: (target: DeskTarget) => void): () => void;
  onInboxState?(cb: (payload: { connected: boolean; deskId?: string; error?: string }) => void): () => void;
  onTermData?(cb: (payload: { id: string; chunk: string }) => void): () => void;
  onTermExit?(cb: (payload: { id: string; code: number | null }) => void): () => void;
};

/**
 * Shown when the renderer hot-reloaded past the preload it is talking to.
 * Restarting the window is the only way to pick up a new bridge.
 */
export const STALE_DESK_HINT = "Desk 主进程还是旧版本，退出 Desk 再重新打开。";

/** Older preloads answered pickFolder with just the path, or `workspaceId` instead of `id`. */
export function asWorkspaceRef(
  picked: (Partial<DeskWorkspaceRef> & { workspaceId?: string }) | string | null | undefined,
): DeskWorkspaceRef | null {
  if (!picked) {
    return null;
  }
  if (typeof picked === "string") {
    return { id: "", folder: picked, name: picked.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || picked, git: false };
  }
  const id = picked.id || picked.workspaceId || "";
  const folder = picked.folder || "";
  if (!folder) {
    return null;
  }
  return {
    id,
    folder,
    name: picked.name || folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder,
    git: Boolean(picked.git),
  };
}

declare global {
  interface Window {
    neoDesk?: NeoDeskBridge;
  }
}

export function deskBridge(): NeoDeskBridge | undefined {
  return typeof window === "undefined" ? undefined : window.neoDesk;
}

export function withApiBase(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const desk = deskBridge();
  if (desk?.proxyApi) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  const origin = (desk?.apiBase || "").replace(/\/$/, "");
  if (!origin) {
    return path;
  }
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Query flag the control plane already accepts. A custom header would CORS-fail on older production. */
export function withDeskClient(path: string): string {
  const hash = path.indexOf("#");
  const beforeHash = hash < 0 ? path : path.slice(0, hash);
  const suffix = hash < 0 ? "" : path.slice(hash);
  const split = beforeHash.indexOf("?");
  const base = split < 0 ? beforeHash : beforeHash.slice(0, split);
  const params = new URLSearchParams(split < 0 ? "" : beforeHash.slice(split + 1));
  if (params.get("client") !== DESK_CLIENT_QUERY) {
    params.set("client", DESK_CLIENT_QUERY);
  }
  const query = params.toString();
  return `${base}${query ? `?${query}` : ""}${suffix}`;
}
