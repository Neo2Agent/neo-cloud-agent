export type DeskTargetKind = "cloud" | "desk" | "remote";

export type DeskTarget = {
  kind: DeskTargetKind;
  folder?: string;
  deskId?: string;
  /** Which bound folder on that machine should run this. */
  workspaceId?: string;
};

export type NeoDeskBridge = {
  platform: string;
  apiBase: string;
  canRunLocal: boolean;
  getToken(): Promise<string>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  pickFolder(): Promise<string | null>;
  getTarget(): Promise<DeskTarget>;
  setTarget(target: DeskTarget): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  openPath?(filePath: string): Promise<void>;
  onDeepLink(cb: (url: string) => void): () => void;
};

declare global {
  interface Window {
    neoDesk?: NeoDeskBridge;
  }
}

export function deskBridge(): NeoDeskBridge | undefined {
  return typeof window === "undefined" ? undefined : window.neoDesk;
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
  const origin = apiBase();
  if (!origin) {
    return path;
  }
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
