export type DeskTargetKind = "cloud" | "desk" | "remote";

export type DeskTarget = {
  kind: DeskTargetKind;
  folder?: string;
  deskId?: string;
  /** Which bound folder on that machine should run this. */
  workspaceId?: string;
};

export type DeskWorkspaceRef = {
  id: string;
  folder: string;
  name: string;
  git: boolean;
};

export type NeoDeskBridge = {
  platform: string;
  apiBase: string;
  canRunLocal: boolean;
  /** Packaged Electron must keep /v1 on the neo-desk:// renderer origin. */
  proxyApi?: boolean;
  getToken(): Promise<string>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  pickFolder(): Promise<string | DeskWorkspaceRef | null>;
  getTarget(): Promise<DeskTarget>;
  setTarget(target: DeskTarget): Promise<void>;
  notify?(title: string, body: string): Promise<void> | void;
  openPath?(filePath: string): Promise<void>;
  onDeepLink?(cb: (url: string) => void): () => void;
  onTarget?(cb: (target: DeskTarget) => void): () => void;
  onDispatched?(cb: (payload: { runId: string; workspace: string }) => void): () => void;
};

declare global {
  interface Window {
    neoDesk?: NeoDeskBridge;
  }
}

export function deskBridge(): NeoDeskBridge | undefined {
  return globalThis.window?.neoDesk;
}

export function isDeskApp(): boolean {
  return Boolean(deskBridge());
}

export function apiBase(): string {
  const base = deskBridge()?.apiBase?.replace(/\/$/, "");
  return base ?? "";
}

export function withApiBase(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (deskBridge()?.proxyApi) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  const origin = apiBase();
  if (!origin) {
    return path;
  }
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Older preloads answered pickFolder with just the path, or `workspaceId` instead of `id`. */
export function asWorkspaceRef(
  picked: (Partial<DeskWorkspaceRef> & { workspaceId?: string }) | string | null | undefined,
): DeskWorkspaceRef | null {
  if (!picked) {
    return null;
  }
  if (typeof picked === "string") {
    const name = picked.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || picked;
    return { id: "", folder: picked, name, git: false };
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

export function subscribeDeskDeepLink(cb: (url: string) => void): () => void {
  return deskBridge()?.onDeepLink?.(cb) ?? (() => {});
}

export function subscribeDeskTarget(cb: (target: DeskTarget) => void): () => void {
  return deskBridge()?.onTarget?.(cb) ?? (() => {});
}

export function subscribeDeskDispatched(cb: (payload: { runId: string; workspace: string }) => void): () => void {
  return deskBridge()?.onDispatched?.(cb) ?? (() => {});
}

export function notifyDesk(title: string, body: string): void {
  const notify = deskBridge()?.notify;
  if (typeof notify === "function") {
    void notify(title, body);
  }
}
