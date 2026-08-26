import type { DeskAssignment } from "@neo-cloud-agent/contracts/desk";

export type DeskTargetKind = "cloud" | "desk" | "remote";

export type DeskTarget = {
  kind: DeskTargetKind;
  folder?: string;
  deskId?: string;
  workspaceId?: string;
};

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
  platform: string;
  apiBase: string;
  canRunLocal: boolean;
  getToken(): Promise<string>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  pickFolder(): Promise<DeskWorkspaceRef | string | null>;
  getTarget(): Promise<DeskTarget>;
  setTarget(target: DeskTarget): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  openPath(filePath: string): Promise<void>;
  listWorkspaces?(): Promise<DeskWorkspaceRef[]>;
  unbindWorkspace?(workspaceId: string): Promise<boolean>;
  getPrefs?(): Promise<{ requireApproval?: boolean; deskId?: string }>;
  setPrefs?(next: { requireApproval?: boolean }): Promise<{ requireApproval?: boolean }>;
  startRun?(assignment: DeskAssignment): Promise<boolean>;
  stopRun?(runId: string): Promise<boolean>;
  listDir?(input: { folder: string; path?: string; content?: boolean }): Promise<LocalFsListing>;
  diffStat?(folder: string): Promise<{ added: number; removed: number } | null>;
  termOpen?(folder: string): Promise<{ id?: string; cwd?: string; error?: string }>;
  termWrite?(id: string, data: string): Promise<boolean>;
  termClose?(id: string): Promise<boolean>;
  onDeepLink?(cb: (url: string) => void): () => void;
  onRunStatus?(cb: (status: DeskRunStatus) => void): () => void;
  onDispatched?(cb: (payload: { runId: string; workspace: string }) => void): () => void;
  onTarget?(cb: (target: DeskTarget) => void): () => void;
  onInboxState?(cb: (payload: { connected: boolean }) => void): () => void;
  onTermData?(cb: (payload: { id: string; chunk: string }) => void): () => void;
  onTermExit?(cb: (payload: { id: string; code: number | null }) => void): () => void;
};

/**
 * Shown when the renderer hot-reloaded past the preload it is talking to.
 * Restarting the window is the only way to pick up a new bridge.
 */
export const STALE_DESK_HINT = "Desk 主进程还是旧版本，退出 Desk 再重新打开。";

/** True when the running preload knows about local files and terminals. */
export function hasLocalTools(bridge = deskBridge()): boolean {
  return Boolean(bridge?.listDir && bridge.termOpen && bridge.startRun);
}

/** Older preloads answered pickFolder with just the path, or `workspaceId` instead of `id`. */
export function asWorkspaceRef(
  picked: (DeskWorkspaceRef & { workspaceId?: string }) | string | null | undefined,
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
  const origin = (deskBridge()?.apiBase || "").replace(/\/$/, "");
  if (!origin) {
    return path;
  }
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
