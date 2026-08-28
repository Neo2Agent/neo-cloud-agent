import { app, BrowserWindow, Menu, Notification, Tray, dialog, net, powerSaveBlocker, protocol, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import type { DeskAssignment, DeskInboxEvent } from "@neo-cloud-agent/contracts";
import { admitLocalRun, normalizeMaxLocalRuns, type ActiveLocalRun } from "../src/admission.js";
import { createLeaseClient } from "../src/lease.js";
import { openDeskInboxStream, type DeskInboxHandle } from "../src/inbox.js";
import { listLocalPath } from "../src/local-fs.js";
import { createLocalShell, type LocalShell } from "../src/local-shell.js";
import { deskLogger } from "../src/log.js";
import {
  controlPlaneOrigin,
  deskRendererUrl,
  isDeskApiProxyPath,
  isDeskPackaged,
  productionControlPlaneCandidates,
} from "../src/ports.js";
import { hashForInvite, hashForRun, inviteTokenFromDeepLink, runIdFromDeepLink } from "../src/protocol.js";
import { deskRepoRoot, spawnDeskWorker } from "../src/spawn.js";
import { isActiveRunStatus } from "../src/stream.js";
import { publicizeWorkerUrls } from "../src/worker-urls.js";
import {
  ignoreNeoDir,
  localWorkspaceDiffStat,
  prepareDeskWorkspace,
  readRepoIdentity,
  runScratchDir,
  runStateDir,
  writeRunBootstrap,
  writeRunExpertFiles,
} from "../src/workspace.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "neo-desk",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

type DeskTarget = { kind: "cloud" | "desk"; folder?: string; deskId?: string; workspaceId?: string };

type BoundWorkspace = { id: string; folder: string; name: string; repoKey: string; git: boolean };

/**
 * `remoteControl` is the whole difference between This Computer and Remote
 * control. Off (default) this machine stays private: folders are never
 * published, so no other client can even see it, let alone dispatch to it.
 */
type DeskPrefs = { requireApproval?: boolean; remoteControl?: boolean; maxLocalRuns?: number };

type InboxState = { connected: boolean; deskId?: string; error?: string };

/** Files under `userData/neo-desk`. Two of them hold tokens. */
const SESSION_STATE_FILE = "session.json";
const PREFS_STATE_FILE = "prefs.json";
const DESK_STATE_FILE = "desk.json";
const TARGET_STATE_FILE = "target.json";
const WORKSPACES_STATE_FILE = "workspaces.json";

/** Anything that can hold a token is written owner-only. */
const SECRET_FILE_MODE = 0o600;

/** How long a packaged build waits for a control plane to answer `/health`. */
const HEALTH_CHECK_TIMEOUT_MS = 4_000;

/** Long-poll window for the desk lease, which doubles as the online heartbeat. */
const LEASE_WAIT_MS = 20_000;
/** A short lease call used only to prove this machine is still registered. */
const LEASE_PROBE_MS = 400;
/** Gap before the next poll: right away after a good one, backing off after a failure. */
const LEASE_IDLE_GAP_MS = 250;
const LEASE_RETRY_GAP_MS = 2_000;
/** How long the renderer waits for an assignment it believes is already queued. */
const TAKE_ASSIGNMENT_WAIT_MS = 8_000;

/** Release is retried because losing it strands the run on a handle that is gone. */
const RELEASE_RETRY_DELAYS_MS = [0, 500, 2_000] as const;

/** Time given to SIGTERM'd workers to back up their session before the app dies. */
const QUIT_GRACE_MS = 3_000;

/** Offline desks dropped in one pass when registration hits the per-user cap. */
const STALE_DESK_PRUNE_LIMIT = 8;

/** Enough of the folder path's hash to keep local workspace ids apart. */
const LOCAL_WORKSPACE_ID_HEX_LEN = 12;

/** macOS and Windows default to case-insensitive paths, so two spellings are one folder. */
const CASE_INSENSITIVE_PATHS = process.platform === "darwin" || process.platform === "win32";

/** How much of a dispatched prompt the approval dialog and notification show. */
const APPROVAL_PROMPT_PREVIEW_LEN = 400;
const NOTIFICATION_PROMPT_PREVIEW_LEN = 80;

const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 900;

const bootLog = deskLogger("boot");
const runLog = deskLogger("local-run");
const deskLog = deskLogger("desk");
const leaseLog = deskLogger("lease");

/** The one-line form of a caught value, for a log field or a UI message. */
function errorText(error: unknown, fallback = ""): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return fallback;
}

let lastRegisterError = "";

function leaseClient() {
  return createLeaseClient(controlPlaneUrl, net.fetch as typeof fetch);
}

let controlPlaneUrl = controlPlaneOrigin();
const stateDir = () => path.join(app.getPath("userData"), "neo-desk");
const stateFile = (name: string) => path.join(stateDir(), name);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let sleepBlocker = 0;
let deskId = "";
let deskToken = "";
let inbox: DeskInboxHandle | null = null;
let leaseLoop = false;
const shells = new Map<string, LocalShell>();

/** One local conversation this process owns. `child` is absent while it spawns. */
type LocalRunEntry = { folder: string; child?: ChildProcess };

/**
 * Local runs this process owns, keyed by runId.
 *
 * The entry is created before the spawn so a run still preparing its workspace
 * already counts against the limit, and it carries the folder so admission can
 * tell same-folder work apart from unrelated folders. This map is the only
 * authority on whether this machine is busy: admission never asks the network.
 */
const localRuns = new Map<string, LocalRunEntry>();

function hasLocalRun(runId: string): boolean {
  return localRuns.has(runId);
}

function activeLocalRuns(): ActiveLocalRun[] {
  // admitLocalRun compares folders as plain strings, so resolve them here.
  return [...localRuns.entries()].map(([runId, entry]) => ({
    runId,
    folder: entry.folder ? path.resolve(entry.folder) : "",
  }));
}

function localRunLimit(): number {
  return normalizeMaxLocalRuns(prefs().maxLocalRuns);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // A missing or half-written state file is normal on first launch; the
    // caller's fallback is the answer and there is nothing to report.
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: SECRET_FILE_MODE });
}

function encodeSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString("base64");
  }
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeSecret(value: string): string {
  const buf = Buffer.from(value, "base64");
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      return "";
    }
  }
  return buf.toString("utf8");
}

function getToken(): string {
  const raw = readJson<{ token?: string }>(stateFile(SESSION_STATE_FILE), {});
  return raw.token ? decodeSecret(raw.token) : "";
}

function setToken(token: string): void {
  writeJson(stateFile(SESSION_STATE_FILE), { token: token ? encodeSecret(token) : "" });
}

function prefs(): DeskPrefs {
  return readJson<DeskPrefs>(stateFile(PREFS_STATE_FILE), {});
}

function setPrefs(next: DeskPrefs): void {
  writeJson(stateFile(PREFS_STATE_FILE), { ...prefs(), ...next });
}

/**
 * Folders this desk agreed to run agents in. The absolute path stays here; the
 * control plane only ever sees the short name and repo key.
 */
function boundWorkspaces(): BoundWorkspace[] {
  return readJson<BoundWorkspace[]>(stateFile(WORKSPACES_STATE_FILE), []);
}

function saveBoundWorkspaces(items: BoundWorkspace[]): void {
  writeJson(stateFile(WORKSPACES_STATE_FILE), items);
}

function findBound(selector: { workspaceId?: string | null; folder?: string }): BoundWorkspace | undefined {
  const items = boundWorkspaces();
  if (selector.workspaceId) {
    return items.find((item) => item.id === selector.workspaceId);
  }
  if (selector.folder) {
    const folder = path.resolve(selector.folder);
    return items.find((item) => path.resolve(item.folder) === folder);
  }
  return undefined;
}

/**
 * The saved target, with a kind this build actually handles.
 *
 * `target.json` is a file on the user's disk that older builds also wrote, so a
 * value like the retired `remote` can still be in there. Anything unknown falls
 * back to cloud rather than leaving the composer pointed at nothing.
 */
function currentTarget(): DeskTarget {
  const saved = readJson<DeskTarget>(stateFile(TARGET_STATE_FILE), { kind: "cloud" });
  const kind: DeskTarget["kind"] = saved.kind === "desk" ? "desk" : "cloud";
  return { ...saved, kind, deskId: saved.deskId || deskId || undefined };
}

function uiDist(): string {
  if (isDeskPackaged()) {
    return path.join(process.env.NEO_DESK_RESOURCES || process.resourcesPath, "ui");
  }
  return path.join(deskRepoRoot(), "packages/desk/ui/dist");
}

async function healthOk(origin: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const response = await net.fetch(`${origin.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
      redirect: "manual",
    });
    return response.status === 200;
  } catch (error) {
    bootLog.warn("control plane health check failed", { origin, detail: errorText(error) });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Packaged builds talk to the production IP. Hostname HTTP 308s onto broken TLS. */
async function resolvePackedControlPlane(): Promise<void> {
  if (!isDeskPackaged()) {
    return;
  }
  process.env.NEO_DESK_RESOURCES = process.resourcesPath;
  for (const origin of productionControlPlaneCandidates()) {
    if (await healthOk(origin)) {
      process.env.NEO_CONTROL_PLANE_URL = origin;
      controlPlaneUrl = origin;
      bootLog.info("control plane selected", { origin });
      return;
    }
  }
  controlPlaneUrl = controlPlaneOrigin();
  process.env.NEO_CONTROL_PLANE_URL = controlPlaneUrl;
  bootLog.warn("no control plane answered, using the default", { origin: controlPlaneUrl });
}

function registerRendererProtocol(): void {
  protocol.handle("neo-desk", async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname || "/");
    if (isDeskApiProxyPath(relative)) {
      return proxyControlPlane(request, url);
    }
    const dist = uiDist();
    const filePath = relative === "/" || relative === "" ? "/index.html" : relative;
    const file = path.normalize(path.join(dist, filePath));
    if (!file.startsWith(dist)) {
      return new Response("forbidden", { status: 403 });
    }
    const target = existsSync(file) ? file : path.join(dist, "index.html");
    return net.fetch(pathToFileURL(target).href);
  });
}

async function proxyControlPlane(request: Request, url: URL): Promise<Response> {
  const target = `${controlPlaneUrl}${url.pathname}${url.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
      init.body = request.body;
      init.duplex = "half";
    }
    return await net.fetch(target, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unreachable";
    return new Response(JSON.stringify({ error: `连不上现网控制面（${controlPlaneUrl}）：${detail}` }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

function rendererEntry(): string {
  const devUrl = deskRendererUrl();
  if (devUrl) {
    return devUrl;
  }
  if (existsSync(path.join(uiDist(), "index.html"))) {
    return "neo-desk://app/";
  }
  throw new Error("Desk UI is missing. Use pnpm dev:desk or build packages/desk/ui first.");
}

function createWindow(): void {
  const title = process.env.NEO_DESK_TITLE?.trim() || "Neo Desk";
  const width = Number(process.env.NEO_DESK_WINDOW_WIDTH || DEFAULT_WINDOW_WIDTH);
  const height = Number(process.env.NEO_DESK_WINDOW_HEIGHT || DEFAULT_WINDOW_HEIGHT);
  const x = Number(process.env.NEO_DESK_WINDOW_X);
  const y = Number(process.env.NEO_DESK_WINDOW_Y);
  mainWindow = new BrowserWindow({
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_WINDOW_WIDTH,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_WINDOW_HEIGHT,
    ...(Number.isFinite(x) ? { x } : {}),
    ...(Number.isFinite(y) ? { y } : {}),
    title,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("did-finish-load", () => {
    void mainWindow?.webContents.executeJavaScript(`document.title = ${JSON.stringify(title)}`);
    mainWindow?.setTitle(title);
  });
  void mainWindow.loadURL(rendererEntry());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function toRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

/** Tell the UI what happened to a local run instead of only logging it. */
function reportRunStatus(payload: {
  runId: string;
  state: "starting" | "running" | "failed" | "stopped";
  detail?: string;
  workspace?: string;
  /** Something worth saying without failing the run, like a shared folder. */
  notice?: string;
}): void {
  toRenderer("desk:run-status", payload);
}

async function confirmFolder(folder: string): Promise<boolean> {
  if (findBound({ folder })) {
    return true;
  }
  const result = await dialog.showMessageBox({
    type: "warning",
    buttons: ["允许", "取消"],
    defaultId: 1,
    cancelId: 1,
    title: "授权本机文件夹",
    message: "Agent 会在这个文件夹里跑命令、直接改这里的文件。",
    detail: folder,
  });
  return result.response === 0;
}

function remoteControlOn(): boolean {
  return prefs().remoteControl === true;
}

/**
 * Bind a folder for local runs. The repo identity only goes to the control
 * plane when the user turned remote control on; This Computer alone never
 * tells anyone which folders exist here.
 */
async function bindWorkspace(folder: string): Promise<BoundWorkspace> {
  const resolved = path.resolve(folder);
  const existing = findBound({ folder: resolved });
  const identity = existing
    ? { name: existing.name, repoKey: existing.repoKey, git: existing.git }
    : await readRepoIdentity(resolved);
  let id = existing?.id || `dws_local_${Buffer.from(resolved).toString("hex").slice(0, LOCAL_WORKSPACE_ID_HEX_LEN)}`;
  if (deskId && deskToken && remoteControlOn()) {
    try {
      const client = leaseClient();
      const bound = await client.bindWorkspace({
        deskId,
        deskToken,
        name: identity.name,
        repoKey: identity.repoKey,
        git: identity.git,
      });
      id = bound.id;
    } catch (error) {
      deskLog.error("could not register the workspace with the control plane", error, { folder: resolved });
      if (existing) {
        return existing;
      }
    }
  } else if (existing) {
    return existing;
  }
  const record: BoundWorkspace = { id, folder: resolved, name: identity.name, repoKey: identity.repoKey, git: identity.git };
  saveBoundWorkspaces([
    ...boundWorkspaces().filter((item) => path.resolve(item.folder) !== resolved && item.id !== id),
    record,
  ]);
  return record;
}

/**
 * True only when the control plane says this run stopped working.
 *
 * Anything we cannot read counts as unfinished. Killing a worker because a
 * status call timed out would throw away live work, and this only ever feeds
 * cleanup: admission counts local processes and never waits on the network.
 *
 * The active set has to include `NOT_YET_STARTED`, because every desk run is
 * queued in that state until this machine's `claim` lands. Leaving it out made
 * a worker between spawn and claim look finished to the next conversation.
 */
async function runHasFinished(runId: string): Promise<boolean> {
  const token = getToken();
  if (!token) {
    return false;
  }
  try {
    const response = await net.fetch(`${controlPlaneUrl}/v1/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) {
      return true;
    }
    if (!response.ok) {
      return false;
    }
    const run = (await response.json()) as { status?: string };
    return !isActiveRunStatus(run.status);
  } catch (error) {
    runLog.warn("could not read run status, leaving the worker alone", { runId, detail: errorText(error) });
    return false;
  }
}

/**
 * Stop workers whose run already ended on the control plane, and say how many
 * slots that freed.
 *
 * A desk worker exits after its own turn, so a process still here means it hung
 * or the run was archived elsewhere. Only called when the limit is what blocks a
 * start, so the usual path never pays for these requests.
 */
async function reapFinishedWorkers(keepRunId: string): Promise<number> {
  const candidates = [...localRuns.entries()]
    .filter(([runId, entry]) => runId !== keepRunId && entry.child)
    .map(([runId]) => runId);
  const finished = await Promise.all(
    candidates.map(async (runId) => ((await runHasFinished(runId)) ? runId : null)),
  );
  let reaped = 0;
  for (const runId of finished) {
    if (!runId) {
      continue;
    }
    runLog.info("retiring a worker whose run already ended", { runId });
    stopRun(runId, "这条本机对话已经结束，本机进程已退出");
    reaped += 1;
  }
  return reaped;
}

/** Which folder this run must work in, or the reason it cannot start. */
function resolveRunFolder(
  assignment: DeskAssignment,
  folderHint?: string,
): { folder: string } | { reason: string } {
  // A run that names a workspace must get that one. Falling back to whatever is
  // selected right now would run against a folder nobody asked for.
  if (assignment.workspaceId) {
    const bound = findBound({ workspaceId: assignment.workspaceId });
    if (!bound) {
      return { reason: "这台电脑上找不到这条对话要用的工作区，可能已经解绑了" };
    }
    return { folder: bound.folder };
  }
  // The caller passes its own folder so two inline runs cannot both resolve to
  // whatever the picker happens to show. The saved target is only a backstop.
  const folder = folderHint || currentTarget().folder || "";
  return folder ? { folder } : { reason: "这台电脑还没有绑定本机工作区" };
}

/**
 * Take a slot for this run, or say why not.
 *
 * The slot is reserved before any `await` returns, so a second assignment
 * arriving mid-spawn counts this run instead of racing past the limit. Only a
 * full machine is worth a round trip: when the limit is what blocks, retiring
 * finished workers can free a slot, and one retry is enough.
 */
async function reserveLocalSlot(runId: string, folder: string): Promise<{ notice?: string } | { reason: string }> {
  const resolved = path.resolve(folder);
  const decide = () =>
    admitLocalRun({
      runId,
      folder: resolved,
      active: activeLocalRuns(),
      limit: localRunLimit(),
      caseInsensitivePaths: CASE_INSENSITIVE_PATHS,
    });
  let decision = decide();
  if (!decision.ok && (await reapFinishedWorkers(runId)) > 0) {
    decision = decide();
  }
  if (!decision.ok) {
    return { reason: decision.reason };
  }
  localRuns.set(runId, { folder });
  return { notice: decision.warning };
}

/** Everything this run needs on disk, plus the URLs its worker should talk to. */
function prepareRunLaunch(
  runId: string,
  assignment: DeskAssignment,
  workspaceDir: string,
): { stateDir: string; scratchDir: string; controlPlaneUrl: string; llmGatewayUrl: string } {
  // The worker writes logs and pasted images here too, so exclude the directory
  // even when this run has no expert files.
  ignoreNeoDir(workspaceDir);
  const stateDirForRun = runStateDir(stateDir(), runId);
  const scratchDirForRun = runScratchDir(workspaceDir, runId);
  const workerUrls = publicizeWorkerUrls(assignment, controlPlaneUrl);
  writeRunBootstrap(stateDirForRun, {
    runId,
    controlPlaneUrl: workerUrls.controlPlaneUrl,
    llmGatewayUrl: workerUrls.llmGatewayUrl,
    jwt: assignment.jwt,
    model: assignment.model,
  });
  writeRunExpertFiles(workspaceDir, scratchDirForRun, assignment);
  return { stateDir: stateDirForRun, scratchDir: scratchDirForRun, ...workerUrls };
}

/** Pipe the worker's output through with its run id, and clean up when it goes. */
function watchLocalWorker(runId: string, child: ChildProcess, workspaceDir: string): void {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[desk:worker ${runId}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[desk:worker ${runId}] ${chunk}`));
  // A process that never came up emits `error` and no `exit`, so without this
  // its slot would stay taken for the rest of the session and the run would sit
  // there looking like it is still starting.
  child.on("error", (error) => {
    if (!localRuns.delete(runId)) {
      return;
    }
    releaseSleepBlockerIfIdle();
    runLog.error("worker could not start", error, { runId, folder: workspaceDir });
    void failRun(runId, errorText(error, "本机 worker 起不来"));
  });
  child.on("exit", (code) => {
    localRuns.delete(runId);
    releaseSleepBlockerIfIdle();
    runLog.info("worker exited", { runId, code, folder: workspaceDir });
    reportRunStatus({ runId, state: "stopped", detail: code === 0 ? undefined : `worker 退出（${code}）` });
    void releaseRun(runId, code);
  });
}

/** Let the machine sleep again once the last local worker is gone. */
function releaseSleepBlockerIfIdle(): void {
  if (localRuns.size > 0 || !sleepBlocker || !powerSaveBlocker.isStarted(sleepBlocker)) {
    return;
  }
  powerSaveBlocker.stop(sleepBlocker);
  sleepBlocker = 0;
}

/**
 * Start the worker for one run on this machine.
 *
 * Both paths land here: the user sending from this window, and a run dispatched
 * from somewhere else. The only difference is who asked.
 */
async function startAssignment(assignment: DeskAssignment, folderHint?: string): Promise<void> {
  const runId = assignment.runId;
  if (hasLocalRun(runId)) {
    return;
  }
  const target = resolveRunFolder(assignment, folderHint);
  if ("reason" in target) {
    await failRun(runId, target.reason);
    return;
  }
  const slot = await reserveLocalSlot(runId, target.folder);
  if ("reason" in slot) {
    await failRun(runId, slot.reason);
    return;
  }
  reportRunStatus({ runId, state: "starting", workspace: target.folder, notice: slot.notice });
  let child: ChildProcess | undefined;
  try {
    const workspaceDir = await prepareDeskWorkspace({ repoDir: target.folder });
    const launch = prepareRunLaunch(runId, assignment, workspaceDir);
    if (!sleepBlocker) {
      sleepBlocker = powerSaveBlocker.start("prevent-app-suspension");
    }
    child = spawnDeskWorker({
      runId,
      jwt: assignment.jwt,
      controlPlaneUrl: launch.controlPlaneUrl,
      llmGatewayUrl: launch.llmGatewayUrl,
      workspaceDir,
      stateDir: launch.stateDir,
      scratchDir: launch.scratchDir,
      model: assignment.model,
    });
    localRuns.set(runId, { folder: workspaceDir, child });
    runLog.info("worker spawned", { runId, pid: child.pid, folder: workspaceDir });
    watchLocalWorker(runId, child, workspaceDir);
    // Claim last. A worker the control plane never learned about would keep
    // editing the folder while the run looks unstarted, so a failure here has
    // to take the process down with it.
    await leaseClient().claim({ deskId, deskToken, runId, workspaceDir, pid: child.pid ?? undefined });
    runLog.info("worker claimed", { runId, folder: workspaceDir });
    reportRunStatus({ runId, state: "running", workspace: workspaceDir });
  } catch (error) {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    localRuns.delete(runId);
    runLog.error("local start failed", error, { runId, folder: target.folder });
    await failRun(runId, errorText(error, "本机启动失败"));
  }
}

/** Tell the UI why a run did not start here, and hand it back to the control plane. */
async function failRun(runId: string, detail: string): Promise<void> {
  reportRunStatus({ runId, state: "failed", detail });
  if (!deskId || !deskToken) {
    return;
  }
  await rejectRun(runId, detail);
}

async function rejectRun(runId: string, reason: string): Promise<void> {
  await leaseClient()
    .reject({ deskId, deskToken, runId, reason })
    .catch((error) => runLog.error("could not reject the run", error, { runId }));
}

/**
 * Tell the control plane the worker is gone.
 *
 * Losing this leaves the run holding a worker handle that no longer exists, and
 * follow-ups then stop being dispatched, so retry before giving up and say so in
 * the UI when it still fails.
 */
async function releaseRun(runId: string, code: number | null): Promise<void> {
  if (!deskId || !deskToken) {
    return;
  }
  const client = leaseClient();
  let lastError: unknown;
  for (const waitMs of RELEASE_RETRY_DELAYS_MS) {
    if (waitMs) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    try {
      await client.release({ deskId, deskToken, runId, code });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  runLog.error("release failed after every retry", lastError, { runId, attempts: RELEASE_RETRY_DELAYS_MS.length });
  reportRunStatus({
    runId,
    state: "stopped",
    detail: "本机进程已退出，但没能告诉现网。下一条消息可能需要点「在这台电脑上继续」。",
  });
}

function stopRun(runId: string, reason?: string): void {
  const child = localRuns.get(runId)?.child;
  localRuns.delete(runId);
  if (!child) {
    return;
  }
  child.kill("SIGTERM");
  reportRunStatus({ runId, state: "stopped", detail: reason });
}

async function handleInboxEvent(event: DeskInboxEvent): Promise<void> {
  if (event.kind === "ping") {
    return;
  }
  if (event.kind === "cancel") {
    stopRun(event.runId, event.reason);
    return;
  }
  const assignment = event.assignment;
  if (hasLocalRun(assignment.runId)) {
    return;
  }
  const bound = findBound({ workspaceId: assignment.workspaceId });
  const label = bound?.name ?? "本机工作区";
  const dispatched = Boolean(assignment.requestedBy) || Boolean(assignment.workspaceId);
  if (dispatched && !remoteControlOn()) {
    // Someone else asked, but this machine is in This Computer mode.
    await rejectRun(assignment.runId, "这台电脑没有开启远程派活");
    return;
  }
  if (prefs().requireApproval) {
    // The binding is the standing permission; this switch is for people who
    // still want to see every remote task before it touches their disk.
    const choice = await dialog.showMessageBox({
      type: "question",
      buttons: ["开始", "拒绝"],
      defaultId: 0,
      cancelId: 1,
      title: "远程派来一条对话",
      message: `${assignment.requestedBy || "你"} 要在 ${label} 里跑一条对话。`,
      detail: assignment.prompt.slice(0, APPROVAL_PROMPT_PREVIEW_LEN),
    });
    if (choice.response !== 0) {
      await rejectRun(assignment.runId, "这台电脑拒绝了这条派活");
      return;
    }
  } else {
    new Notification({
      title: "本机开始一条对话",
      body: `${label} · ${assignment.prompt.slice(0, NOTIFICATION_PROMPT_PREVIEW_LEN)}`,
    }).show();
  }
  toRenderer("desk:dispatched", { runId: assignment.runId, workspace: label });
  await startAssignment(assignment, bound?.folder);
}

let connecting: Promise<void> | null = null;

function reportPresence(connected: boolean, error?: string): void {
  toRenderer("desk:inbox-state", { connected, deskId, error } satisfies InboxState);
}

async function persistRegisteredDesk(registered: { deskId: string; token: string }): Promise<void> {
  deskId = registered.deskId;
  deskToken = registered.token;
  writeJson(stateFile(DESK_STATE_FILE), { deskId, token: encodeSecret(deskToken) });
  const saved = readJson<DeskTarget>(stateFile(TARGET_STATE_FILE), { kind: "cloud" });
  for (const item of remoteControlOn() ? boundWorkspaces() : []) {
    const bound = await bindWorkspace(item.folder).catch((error) => {
      deskLog.warn("could not re-bind a workspace after registering", {
        folder: item.folder,
        detail: errorText(error),
      });
      return undefined;
    });
    if (bound && saved.folder && path.resolve(saved.folder) === path.resolve(bound.folder)) {
      saved.workspaceId = bound.id;
    }
  }
  writeJson(stateFile(TARGET_STATE_FILE), { ...saved, deskId });
  toRenderer("desk:target", { ...saved, deskId });
}

async function pruneOfflineDesks(userToken: string): Promise<void> {
  const desks = await leaseClient().listDesks(userToken);
  const stale = desks
    .filter((item) => item.online !== true && item.id !== deskId)
    .slice(0, STALE_DESK_PRUNE_LIMIT);
  for (const item of stale) {
    await leaseClient().deleteDesk(userToken, item.id).catch((error) => {
      deskLog.warn("could not prune a stale desk", { deskId: item.id, detail: errorText(error) });
    });
  }
}

async function registerThisDesk(userToken: string): Promise<void> {
  const client = leaseClient();
  const request = {
    name: os.hostname(),
    hostname: os.hostname(),
    platform: process.platform,
    userToken,
  };
  try {
    await persistRegisteredDesk(await client.register(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/at most/i.test(message)) {
      throw error;
    }
    await pruneOfflineDesks(userToken);
    await persistRegisteredDesk(await client.register(request));
  }
  await publishRemoteControl(userToken);
}

/**
 * A desk registers so it can run its own work; that is not consent to be
 * dispatched to. Only remote control mode makes it visible to other clients.
 */
async function publishRemoteControl(userToken = getToken()): Promise<void> {
  if (!deskId || !userToken) {
    return;
  }
  const on = remoteControlOn();
  await leaseClient()
    .setAllowRemote(userToken, deskId, on)
    .catch((error) => deskLog.warn("could not change remote control", { on, detail: errorText(error) }));
  if (!on) {
    return;
  }
  for (const item of boundWorkspaces()) {
    await bindWorkspace(item.folder).catch((error) =>
      deskLog.warn("could not publish a workspace", { folder: item.folder, detail: errorText(error) }),
    );
  }
}

/** Production marks a desk online from lastSeen, which lease refreshes. Inbox is newer. */
async function heartbeatLease(waitMs: number): Promise<"ok" | "auth" | "down"> {
  if (!deskId || !deskToken) {
    return "auth";
  }
  try {
    const assignment = await leaseClient().waitAssignment({ deskId, deskToken, waitMs });
    lastRegisterError = "";
    reportPresence(true);
    if (assignment) {
      void handleInboxEvent({ kind: "assignment", assignment });
    }
    return "ok";
  } catch (error) {
    const message = errorText(error, "desk lease failed");
    leaseLog.error("lease poll failed", error, { deskId, waitMs });
    if (/unauthorized|login_required|desk not found/i.test(message)) {
      return "auth";
    }
    reportPresence(false, `本机保活失败：${message}`);
    return "down";
  }
}

function startLeaseLoop(): void {
  if (leaseLoop || !deskId || !deskToken) {
    return;
  }
  leaseLoop = true;
  const tick = async () => {
    if (!leaseLoop) {
      return;
    }
    const result = await heartbeatLease(LEASE_WAIT_MS);
    if (result === "auth") {
      leaseLoop = false;
      deskId = "";
      deskToken = "";
      inbox?.close();
      inbox = null;
      void connectInbox();
      return;
    }
    if (leaseLoop) {
      setTimeout(() => void tick(), result === "ok" ? LEASE_IDLE_GAP_MS : LEASE_RETRY_GAP_MS);
    }
  };
  void tick();
}

function stopLeaseLoop(): void {
  leaseLoop = false;
}

async function connectInbox(): Promise<void> {
  if (connecting) {
    return connecting;
  }
  connecting = connectInboxOnce().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function connectInboxOnce(): Promise<void> {
  const userToken = getToken();
  if (!userToken) {
    return;
  }
  try {
    if (deskId && deskToken) {
      const stillValid = await heartbeatLease(LEASE_PROBE_MS);
      if (stillValid === "auth") {
        deskId = "";
        deskToken = "";
      }
    }
    if (!deskId || !deskToken) {
      await registerThisDesk(userToken);
      const online = await heartbeatLease(LEASE_PROBE_MS);
      if (online !== "ok") {
        throw new Error("本机已登记，但现网还没把它标成在线");
      }
    }
    lastRegisterError = "";
    toRenderer("desk:target", currentTarget());
    reportPresence(true);
    startLeaseLoop();
  } catch (error) {
    lastRegisterError = errorText(error, "desk register failed");
    deskLog.error("could not register this machine", error, { controlPlaneUrl });
    reportPresence(false, `本机登记失败：${lastRegisterError}`);
    return;
  }
  if (inbox) {
    return;
  }
  inbox = openDeskInboxStream({
    baseUrl: controlPlaneUrl,
    deskId,
    deskToken,
    fetchImpl: net.fetch as typeof fetch,
    onEvent: (event) => void handleInboxEvent(event),
    onStateChange: (connected) => {
      if (connected) {
        reportPresence(true);
      }
    },
    onUnavailable: () => {
      inbox?.close();
      inbox = null;
    },
    onUnauthorized: () => {
      void (async () => {
        // Production has no inbox route, so a desk token gets 401 there even
        // while lease still proves this machine is registered.
        const leaseOk = await heartbeatLease(LEASE_PROBE_MS);
        inbox?.close();
        inbox = null;
        if (leaseOk === "ok") {
          return;
        }
        deskId = "";
        deskToken = "";
        stopLeaseLoop();
        void connectInbox();
      })();
    },
  });
}

function wireIpc(): void {
  const { ipcMain } = require("electron") as typeof import("electron");
  ipcMain.handle("desk:getToken", () => getToken());
  ipcMain.handle("desk:setToken", async (_event, token: string) => {
    setToken(token);
    lastRegisterError = "";
    await connectInbox();
    return { deskId: deskId || undefined, error: lastRegisterError || undefined };
  });
  ipcMain.handle("desk:clearToken", () => {
    setToken("");
    stopLeaseLoop();
    inbox?.close();
    inbox = null;
  });
  ipcMain.handle("desk:pickFolder", async () => {
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const folder = picked.filePaths[0];
    if (!folder) {
      return null;
    }
    if (!(await confirmFolder(folder))) {
      return null;
    }
    const bound = await bindWorkspace(folder);
    const target = { kind: "desk" as const, folder: bound.folder, deskId, workspaceId: bound.id };
    writeJson(stateFile(TARGET_STATE_FILE), target);
    toRenderer("desk:target", target);
    return { id: bound.id, folder: bound.folder, name: bound.name, git: bound.git };
  });
  ipcMain.handle("desk:listWorkspaces", () =>
    boundWorkspaces().map((item) => ({
      id: item.id,
      folder: item.folder,
      name: item.name,
      git: item.git,
    })),
  );
  ipcMain.handle("desk:unbindWorkspace", async (_event, workspaceId: string) => {
    saveBoundWorkspaces(boundWorkspaces().filter((item) => item.id !== workspaceId));
    if (deskId && deskToken) {
      await leaseClient()
        .unbindWorkspace({ deskId, deskToken, workspaceId })
        .catch((error) => deskLog.error("could not unbind the workspace", error, { workspaceId }));
    }
    return true;
  });
  ipcMain.handle("desk:getTarget", () => currentTarget());
  ipcMain.handle("desk:setTarget", (_event, target: DeskTarget) => {
    const bound = findBound({ folder: target.folder });
    writeJson(stateFile(TARGET_STATE_FILE), {
      ...target,
      deskId: deskId || target.deskId || undefined,
      workspaceId: bound?.id ?? target.workspaceId,
    });
  });
  ipcMain.handle("desk:getPrefs", () => ({ ...prefs(), deskId }));
  ipcMain.handle("desk:setPrefs", async (_event, next: DeskPrefs) => {
    const before = remoteControlOn();
    setPrefs(next);
    if (remoteControlOn() !== before) {
      await publishRemoteControl();
    }
    return prefs();
  });
  ipcMain.handle("desk:startRun", async (_event, assignment: DeskAssignment, folder?: string) => {
    await startAssignment(assignment, folder);
    return true;
  });
  ipcMain.handle("desk:takeAssignment", async (_event, runId?: string, folder?: string) => {
    if (runId && hasLocalRun(runId)) {
      return { started: true, runId };
    }
    if (!deskId || !deskToken) {
      return { started: false };
    }
    const assignment = await leaseClient().waitAssignment({
      deskId,
      deskToken,
      waitMs: TAKE_ASSIGNMENT_WAIT_MS,
    });
    if (runId && hasLocalRun(runId)) {
      return { started: true, runId };
    }
    if (!assignment || (runId && assignment.runId !== runId)) {
      return { started: false, runId: assignment?.runId };
    }
    await startAssignment(assignment, folder);
    return { started: true, runId: assignment.runId };
  });
  ipcMain.handle("desk:stopRun", (_event, runId: string) => {
    stopRun(runId, "已在这台电脑上停止");
    return true;
  });
  ipcMain.handle("desk:notify", (_event, title: string, body: string) => {
    new Notification({ title, body }).show();
  });
  ipcMain.handle("desk:openPath", async (_event, filePath: string) => {
    if (filePath.startsWith("http")) {
      await shell.openExternal(filePath);
      return;
    }
    await shell.openPath(filePath);
  });
  ipcMain.handle("desk:listDir", (_event, input: { folder: string; path?: string; content?: boolean }) => {
    try {
      return listLocalPath(input.folder, input.path ?? "", { content: input.content === true });
    } catch (error) {
      return { error: errorText(error, "读取失败") };
    }
  });
  ipcMain.handle("desk:diffStat", async (_event, folder: string) => {
    try {
      return await localWorkspaceDiffStat(folder);
    } catch (error) {
      // A folder that is not a repo, or a git that will not run, just means the
      // panel shows no change counts.
      runLog.warn("could not read the workspace diff", { folder, detail: errorText(error) });
      return null;
    }
  });
  ipcMain.handle("desk:termOpen", (_event, folder: string) => {
    if (!folder || !existsSync(folder)) {
      return { error: "本机工作区不存在" };
    }
    const shellSession = createLocalShell({
      cwd: folder,
      hooks: {
        onData: (id, chunk) => toRenderer("desk:term-data", { id, chunk }),
        onExit: (id, code) => {
          shells.delete(id);
          toRenderer("desk:term-exit", { id, code });
        },
      },
    });
    shells.set(shellSession.id, shellSession);
    return { id: shellSession.id, cwd: shellSession.cwd };
  });
  ipcMain.handle("desk:termWrite", (_event, input: { id: string; data: string }) => {
    shells.get(input.id)?.write(input.data);
    return true;
  });
  ipcMain.handle("desk:termClose", (_event, id: string) => {
    shells.get(id)?.kill();
    shells.delete(id);
    return true;
  });
}

app.whenReady().then(async () => {
  if (isDeskPackaged()) {
    process.env.NEO_DESK_RESOURCES = process.resourcesPath;
  }
  await resolvePackedControlPlane();
  Menu.setApplicationMenu(null);
  if (existsSync(stateFile(DESK_STATE_FILE))) {
    const saved = readJson<{ deskId?: string; token?: string }>(stateFile(DESK_STATE_FILE), {});
    deskId = saved.deskId ?? "";
    deskToken = saved.token ? decodeSecret(saved.token) : "";
  }
  if (existsSync(path.join(uiDist(), "index.html"))) {
    registerRendererProtocol();
  }
  wireIpc();
  createWindow();
  if (process.platform !== "linux" || process.env.NEO_DESK_TRAY === "1") {
    try {
      tray = new Tray(path.join(__dirname, "icon.png"));
      tray.setToolTip("Neo Desk");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开", click: () => mainWindow?.show() },
          { label: "退出", click: () => app.quit() },
        ]),
      );
    } catch (error) {
      bootLog.warn("no tray icon on this platform", { detail: errorText(error) });
    }
  }
  void connectInbox();
  app.setAsDefaultProtocolClient("neo");
});

app.on("open-url", (_event, url) => {
  if (!mainWindow) return;
  const runId = runIdFromDeepLink(url);
  const inviteToken = inviteTokenFromDeepLink(url);
  const hash = runId ? hashForRun(runId) : inviteToken ? hashForInvite(inviteToken) : "";
  if (!hash) return;
  void mainWindow.loadURL(`${rendererEntry().replace(/\/$/, "")}/${hash}`);
  mainWindow.webContents.send("desk:deep-link", url);
});

let shuttingDown = false;

/**
 * Quitting must take the workers with it.
 *
 * They edit the user's own folder, so a leftover process would keep writing to a
 * repo nobody is watching. The workers back up their session on SIGTERM, so the
 * short wait here is about letting that finish and telling the control plane the
 * handle is gone.
 */
app.on("before-quit", (event) => {
  inbox?.close();
  for (const shellSession of shells.values()) {
    shellSession.kill();
  }
  if (shuttingDown || localRuns.size === 0) {
    return;
  }
  shuttingDown = true;
  event.preventDefault();
  const running = [...localRuns.entries()];
  localRuns.clear();
  for (const [runId, entry] of running) {
    runLog.info("stopping the worker for app quit", { runId, pid: entry.child?.pid });
    entry.child?.kill("SIGTERM");
  }
  const releases = running.map(([runId]) => releaseRun(runId, null));
  const settled = Promise.allSettled(releases);
  const deadline = new Promise((resolve) => setTimeout(resolve, QUIT_GRACE_MS));
  void Promise.race([settled, deadline]).then(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
