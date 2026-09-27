export const TARGET_CLOUD = "cloud" as const;
export const TARGET_DESK = "desk" as const;
export const TARGET_REMOTE = "remote" as const;
export const DESK_CLIENT_QUERY = "desk";

export type DeskTargetKind = typeof TARGET_CLOUD | typeof TARGET_DESK | typeof TARGET_REMOTE;

export type DeskTarget = {
  kind: DeskTargetKind;
  folder?: string;
  deskId?: string;
  /** Bound workspace on a *remote* machine. Inline This Computer / Remote Control must not send this. */
  workspaceId?: string;
};

export type DeskWorkspaceRef = {
  id: string;
  folder: string;
  name: string;
  git: boolean;
};

export type LocalRunTarget = {
  loop: "desk" | "cloud";
  tools: "desk";
  deskId?: string;
  remoteControl?: true;
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
  getPrefs?(): Promise<{ deskId?: string }>;
  startRun?(assignment: unknown, folder?: string): Promise<boolean>;
  takeAssignment?(runId?: string, folder?: string): Promise<{ started?: boolean; runId?: string }>;
  notify?(title: string, body: string): Promise<void> | void;
  openPath?(filePath: string): Promise<void>;
  gitCommit?(input: {
    runId: string;
    folder?: string;
    message: string;
  }): Promise<{ sha?: string; branch?: string; empty?: boolean; error?: string }>;
  onDeepLink?(cb: (url: string) => void): () => void;
  onTarget?(cb: (target: DeskTarget) => void): () => void;
  onDispatched?(cb: (payload: { runId: string; workspace: string }) => void): () => void;
};

export const MISSING_DESK_ID_HINT = "本机还没登记到控制面。等连上后再发，或退出重新登录。";
export const REMOTE_LOOP_HINT = "Remote Control 需要 neo-loop。控制面 /health 里 neoLoop.available=false。";
export const REMOTE_FOLDER_HINT = "Remote Control 要先选一个本机文件夹，网页才能在同一目录接着聊。";
export const STALE_DESK_HINT = "Desk 主进程还是旧版本，退出 Desk 再重新打开。";

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

export function isLocalDeskKind(kind?: DeskTargetKind | null): boolean {
  return kind === TARGET_DESK || kind === TARGET_REMOTE;
}

/** Folder picker keeps Remote Control; Cloud falls back to This Computer. */
export function pickedLocalKind(kind?: DeskTargetKind | null): DeskTargetKind {
  return kind === TARGET_REMOTE ? TARGET_REMOTE : TARGET_DESK;
}

/**
 * Cursor Remote Control keeps the remoteControl flag even on a desk loop.
 * Older `{loop:desk, remoteControl}` chats stay labeled Remote Control.
 */
export function localRunLabel(run?: {
  executionTarget?: { loop?: string; tools?: string; remoteControl?: boolean } | null;
} | null): string {
  const target = run?.executionTarget;
  if (target?.remoteControl === true && (target.tools === "desk" || target.loop === "desk")) {
    return "Remote Control";
  }
  return "This Computer";
}

export function localCreateHint(kind: DeskTargetKind, folder: string): string {
  const folderPath = folder.trim();
  if (kind === TARGET_REMOTE) {
    return folderPath ? `Remote Control · ${folderPath}` : REMOTE_FOLDER_HINT;
  }
  return folderPath ? `This Computer · ${folderPath}` : "This Computer 可以不绑文件夹，或先选一个目录。";
}

export function apiBase(): string {
  const base = deskBridge()?.apiBase?.replace(/\/$/, "");
  return base ?? "";
}

/** Query the control plane already accepts. A custom header would CORS-fail on older production. */
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

export function withApiBase(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return isDeskApp() ? withDeskClient(path) : path;
  }
  let resolved = path;
  if (deskBridge()?.proxyApi) {
    resolved = path.startsWith("/") ? path : `/${path}`;
  } else {
    const origin = apiBase();
    resolved = origin ? `${origin}${path.startsWith("/") ? path : `/${path}`}` : path;
  }
  return isDeskApp() ? withDeskClient(resolved) : resolved;
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

export function mergeDeskTarget(target: DeskTarget, deskId?: string): DeskTarget {
  const id = (deskId || target.deskId || "").trim();
  return id ? { ...target, deskId: id } : { ...target, deskId: undefined };
}

/**
 * This Computer keeps the loop on this laptop.
 * Remote Control puts the loop in neo-loop and only the tools on this disk.
 * Inline create must not send deskWorkspaceId — the folder lives in repoUrls.
 */
export function localRunTarget(target: DeskTarget, deskId?: string): LocalRunTarget {
  const merged = mergeDeskTarget(target, deskId);
  if (merged.kind === TARGET_REMOTE) {
    return {
      loop: "cloud",
      tools: "desk",
      deskId: merged.deskId,
      remoteControl: true,
    };
  }
  return {
    loop: "desk",
    tools: "desk",
    deskId: merged.deskId,
  };
}

/** Persist Cloud / This Computer / Remote Control. Unknown kinds fall back to cloud. */
export function normalizeDeskTarget(target: DeskTarget | null | undefined): DeskTarget {
  if (!target) {
    return { kind: TARGET_CLOUD };
  }
  if (target.kind === TARGET_DESK || target.kind === TARGET_REMOTE || target.kind === TARGET_CLOUD) {
    return target;
  }
  return { ...target, kind: TARGET_CLOUD };
}

export function gateLocalCreate(input: {
  canRunLocal: boolean;
  kind: DeskTargetKind;
  deskId?: string;
  folder: string;
  remoteAvailable: boolean;
}): string | null {
  if (!input.canRunLocal || !isLocalDeskKind(input.kind)) {
    return null;
  }
  if (input.kind === TARGET_REMOTE && !input.remoteAvailable) {
    return REMOTE_LOOP_HINT;
  }
  if (input.kind === TARGET_REMOTE && !input.folder.trim()) {
    return REMOTE_FOLDER_HINT;
  }
  if (!input.deskId?.trim()) {
    return MISSING_DESK_ID_HINT;
  }
  return null;
}

export type HostCreateRunFields = {
  source: "desk" | "web";
  start?: "inline";
  kernel?: "agentscope";
  repoUrls: string[];
  skipRepoDefaults: boolean;
  target: LocalRunTarget | { loop: "cloud"; tools: "cloud" };
};

export type TargetPickerOption = { value: string; label: string; disabled?: boolean };

/**
 * Web / phone only start Cloud. Desk Electron adds This Computer and Remote Control.
 * Web dispatch onto another machine is a later product, not Remote Control follow.
 */
export function targetPickerOptions(input: { canRunLocal: boolean; remoteAvailable: boolean }): TargetPickerOption[] {
  if (!input.canRunLocal) {
    return [{ value: TARGET_CLOUD, label: "云端" }];
  }
  return [
    { value: TARGET_CLOUD, label: "云端" },
    { value: TARGET_DESK, label: "This Computer" },
    {
      value: TARGET_REMOTE,
      label: input.remoteAvailable ? "Remote Control" : "Remote Control（neo-loop 未就绪）",
      ...(input.remoteAvailable ? {} : { disabled: true }),
    },
  ];
}

/** Browser / phone always create cloud. Desk Electron inlines This Computer and Remote Control. */
export function hostCreateRunFields(input: {
  canRunLocal: boolean;
  target: DeskTarget;
  deskId?: string;
  folder: string;
  cloudRepoUrls: string[];
  skipCloudRepoDefaults: boolean;
}): HostCreateRunFields {
  if (!input.canRunLocal) {
    return {
      source: "web",
      repoUrls: input.cloudRepoUrls,
      skipRepoDefaults: input.skipCloudRepoDefaults,
      target: { loop: "cloud", tools: "cloud" },
    };
  }
  if (isLocalDeskKind(input.target.kind)) {
    return {
      source: "desk",
      start: "inline",
      kernel: input.target.kind === TARGET_REMOTE ? "agentscope" : undefined,
      repoUrls: input.folder.trim() ? [input.folder] : [],
      skipRepoDefaults: false,
      target: localRunTarget(input.target, input.deskId),
    };
  }
  return {
    source: "desk",
    repoUrls: input.cloudRepoUrls,
    skipRepoDefaults: input.skipCloudRepoDefaults,
    target: { loop: "cloud", tools: "cloud" },
  };
}
