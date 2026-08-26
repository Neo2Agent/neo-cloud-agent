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

export type NeoDeskBridge = {
  platform: string;
  apiBase: string;
  canRunLocal: boolean;
  getToken(): Promise<string>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  pickFolder(): Promise<DeskWorkspaceRef | null>;
  listWorkspaces(): Promise<DeskWorkspaceRef[]>;
  unbindWorkspace(workspaceId: string): Promise<boolean>;
  getTarget(): Promise<DeskTarget>;
  setTarget(target: DeskTarget): Promise<void>;
  getPrefs(): Promise<{ requireApproval?: boolean; deskId?: string }>;
  setPrefs(next: { requireApproval?: boolean }): Promise<{ requireApproval?: boolean }>;
  startRun(assignment: DeskAssignment): Promise<boolean>;
  stopRun(runId: string): Promise<boolean>;
  notify(title: string, body: string): Promise<void>;
  openPath(filePath: string): Promise<void>;
  listDir(input: { folder: string; path?: string; content?: boolean }): Promise<LocalFsListing>;
  diffStat(folder: string): Promise<{ added: number; removed: number } | null>;
  termOpen(folder: string): Promise<{ id?: string; cwd?: string; error?: string }>;
  termWrite(id: string, data: string): Promise<boolean>;
  termClose(id: string): Promise<boolean>;
  onDeepLink?(cb: (url: string) => void): () => void;
  onRunStatus?(cb: (status: DeskRunStatus) => void): () => void;
  onDispatched?(cb: (payload: { runId: string; workspace: string }) => void): () => void;
  onInboxState?(cb: (payload: { connected: boolean }) => void): () => void;
  onTermData?(cb: (payload: { id: string; chunk: string }) => void): () => void;
  onTermExit?(cb: (payload: { id: string; code: number | null }) => void): () => void;
};

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
