import { app, BrowserWindow, Menu, Notification, Tray, dialog, net, powerSaveBlocker, protocol, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import type { DeskAssignment, DeskInboxEvent } from "@neo-cloud-agent/contracts";
import { createLeaseClient } from "../src/lease.js";
import { openDeskInboxStream, type DeskInboxHandle } from "../src/inbox.js";
import { listLocalPath } from "../src/local-fs.js";
import { createLocalShell, type LocalShell } from "../src/local-shell.js";
import { controlPlaneOrigin, deskRendererUrl } from "../src/ports.js";
import { hashForInvite, hashForRun, inviteTokenFromDeepLink, runIdFromDeepLink } from "../src/protocol.js";
import { deskRepoRoot, spawnDeskWorker } from "../src/spawn.js";
import {
  ignoreNeoDir,
  localWorkspaceDiffStat,
  prepareDeskWorkspace,
  readRepoIdentity,
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

type DeskTarget = { kind: "cloud" | "desk" | "remote"; folder?: string; deskId?: string; workspaceId?: string };

type BoundWorkspace = { id: string; folder: string; name: string; repoKey: string; git: boolean };

type DeskPrefs = { requireApproval?: boolean };

const controlPlaneUrl = controlPlaneOrigin();
const stateDir = () => path.join(app.getPath("userData"), "neo-desk");
const stateFile = (name: string) => path.join(stateDir(), name);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let sleepBlocker = 0;
let deskId = "";
let deskToken = "";
let inbox: DeskInboxHandle | null = null;
const workers = new Map<string, ChildProcess>();
const shells = new Map<string, LocalShell>();
/** Runs this process already started, so an inbox echo never double-spawns. */
const startedRuns = new Set<string>();

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
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
  const raw = readJson<{ token?: string }>(stateFile("session.json"), {});
  return raw.token ? decodeSecret(raw.token) : "";
}

function setToken(token: string): void {
  writeJson(stateFile("session.json"), { token: token ? encodeSecret(token) : "" });
}

function prefs(): DeskPrefs {
  return readJson<DeskPrefs>(stateFile("prefs.json"), {});
}

function setPrefs(next: DeskPrefs): void {
  writeJson(stateFile("prefs.json"), { ...prefs(), ...next });
}

/**
 * Folders this desk agreed to run agents in. The absolute path stays here; the
 * control plane only ever sees the short name and repo key.
 */
function boundWorkspaces(): BoundWorkspace[] {
  return readJson<BoundWorkspace[]>(stateFile("workspaces.json"), []);
}

function saveBoundWorkspaces(items: BoundWorkspace[]): void {
  writeJson(stateFile("workspaces.json"), items);
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

function currentTarget(): DeskTarget {
  const saved = readJson<DeskTarget>(stateFile("target.json"), { kind: "cloud" });
  return { ...saved, deskId: saved.deskId || deskId || undefined };
}

function uiDist(): string {
  return path.join(deskRepoRoot(), "packages/desk/ui/dist");
}

function registerRendererProtocol(): void {
  protocol.handle("neo-desk", (request) => {
    const dist = uiDist();
    const url = new URL(request.url);
    let relative = decodeURIComponent(url.pathname || "/");
    if (relative === "/" || relative === "") {
      relative = "/index.html";
    }
    const file = path.normalize(path.join(dist, relative));
    if (!file.startsWith(dist)) {
      return new Response("forbidden", { status: 403 });
    }
    const target = existsSync(file) ? file : path.join(dist, "index.html");
    return net.fetch(pathToFileURL(target).href);
  });
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
  const width = Number(process.env.NEO_DESK_WINDOW_WIDTH || 1440);
  const height = Number(process.env.NEO_DESK_WINDOW_HEIGHT || 900);
  const x = Number(process.env.NEO_DESK_WINDOW_X);
  const y = Number(process.env.NEO_DESK_WINDOW_Y);
  mainWindow = new BrowserWindow({
    width: Number.isFinite(width) && width > 0 ? width : 1440,
    height: Number.isFinite(height) && height > 0 ? height : 900,
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

/** Bind a folder locally and register its repo identity so remote dispatch can match it. */
async function bindWorkspace(folder: string): Promise<BoundWorkspace> {
  const resolved = path.resolve(folder);
  const existing = findBound({ folder: resolved });
  const identity = existing
    ? { name: existing.name, repoKey: existing.repoKey, git: existing.git }
    : await readRepoIdentity(resolved);
  let id = existing?.id || `dws_local_${Buffer.from(resolved).toString("hex").slice(0, 12)}`;
  if (deskId && deskToken) {
    try {
      const client = createLeaseClient(controlPlaneUrl);
      const bound = await client.bindWorkspace({
        deskId,
        deskToken,
        name: identity.name,
        repoKey: identity.repoKey,
        git: identity.git,
      });
      id = bound.id;
    } catch (error) {
      console.error("failed to register desk workspace", error);
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
 * Start the worker for one run on this machine.
 *
 * Both paths land here: the user sending from this window, and a run dispatched
 * from somewhere else. The only difference is who asked.
 */
async function startAssignment(assignment: DeskAssignment, folderHint?: string): Promise<void> {
  const runId = assignment.runId;
  if (startedRuns.has(runId) || workers.has(runId)) {
    return;
  }
  const client = createLeaseClient(controlPlaneUrl);
  const fail = async (detail: string) => {
    reportRunStatus({ runId, state: "failed", detail });
    if (deskId && deskToken) {
      await client.reject({ deskId, deskToken, runId, reason: detail }).catch((error) => {
        console.error("failed to reject desk run", error);
      });
    }
  };
  // A run that names a workspace must get that one. Falling back to whatever is
  // selected right now would run against a folder nobody asked for.
  let folder = "";
  if (assignment.workspaceId) {
    const bound = findBound({ workspaceId: assignment.workspaceId });
    if (!bound) {
      await fail("这台电脑上找不到这条对话要用的工作区，可能已经解绑了");
      return;
    }
    folder = bound.folder;
  } else {
    folder = folderHint || currentTarget().folder || "";
  }
  if (!folder) {
    await fail("这台电脑还没有绑定本机工作区");
    return;
  }
  // One local worker at a time, so two agents never edit the same folder at once.
  if ([...workers.keys()].some((id) => id !== runId)) {
    await fail("这台电脑已经有一条本机对话在跑，先停掉它再开新的");
    return;
  }
  startedRuns.add(runId);
  reportRunStatus({ runId, state: "starting", workspace: folder });
  try {
    const workspaceDir = await prepareDeskWorkspace({ repoDir: folder });
    // The worker writes .neo/logs here too, so exclude it even with no expert.
    ignoreNeoDir(workspaceDir);
    const stateDirForRun = runStateDir(stateDir(), runId);
    writeRunBootstrap(stateDirForRun, {
      runId,
      controlPlaneUrl: assignment.controlPlaneUrl,
      llmGatewayUrl: assignment.llmGatewayUrl,
      jwt: assignment.jwt,
      model: assignment.model,
    });
    writeRunExpertFiles(workspaceDir, assignment);
    if (!sleepBlocker) {
      sleepBlocker = powerSaveBlocker.start("prevent-app-suspension");
    }
    const child = spawnDeskWorker({
      runId,
      jwt: assignment.jwt,
      controlPlaneUrl: assignment.controlPlaneUrl,
      llmGatewayUrl: assignment.llmGatewayUrl,
      workspaceDir,
      stateDir: stateDirForRun,
      model: assignment.model,
    });
    workers.set(runId, child);
    await client.claim({ deskId, deskToken, runId, workspaceDir, pid: child.pid ?? undefined });
    reportRunStatus({ runId, state: "running", workspace: workspaceDir });
    child.stdout?.on("data", (chunk) => process.stdout.write(`[desk-worker ${runId}] ${chunk}`));
    child.stderr?.on("data", (chunk) => process.stderr.write(`[desk-worker ${runId}] ${chunk}`));
    child.on("exit", (code) => {
      workers.delete(runId);
      startedRuns.delete(runId);
      reportRunStatus({ runId, state: "stopped", detail: code === 0 ? undefined : `worker 退出（${code}）` });
      if (workers.size === 0 && sleepBlocker && powerSaveBlocker.isStarted(sleepBlocker)) {
        powerSaveBlocker.stop(sleepBlocker);
        sleepBlocker = 0;
      }
    });
  } catch (error) {
    startedRuns.delete(runId);
    workers.delete(runId);
    await fail(error instanceof Error ? error.message : "本机启动失败");
  }
}

function stopRun(runId: string, reason?: string): void {
  const child = workers.get(runId);
  if (!child) {
    startedRuns.delete(runId);
    return;
  }
  child.kill("SIGTERM");
  workers.delete(runId);
  startedRuns.delete(runId);
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
  if (startedRuns.has(assignment.runId) || workers.has(assignment.runId)) {
    return;
  }
  const bound = findBound({ workspaceId: assignment.workspaceId });
  const label = bound?.name ?? "本机工作区";
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
      detail: assignment.prompt.slice(0, 400),
    });
    if (choice.response !== 0) {
      await createLeaseClient(controlPlaneUrl)
        .reject({ deskId, deskToken, runId: assignment.runId, reason: "这台电脑拒绝了这条派活" })
        .catch((error) => console.error("failed to reject desk run", error));
      return;
    }
  } else {
    new Notification({ title: "本机开始一条对话", body: `${label} · ${assignment.prompt.slice(0, 80)}` }).show();
  }
  toRenderer("desk:dispatched", { runId: assignment.runId, workspace: label });
  await startAssignment(assignment, bound?.folder);
}

let connecting: Promise<void> | null = null;

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
  const client = createLeaseClient(controlPlaneUrl);
  if (!deskId || !deskToken) {
    try {
      const registered = await client.register({
        name: os.hostname(),
        hostname: os.hostname(),
        platform: process.platform,
        userToken,
      });
      deskId = registered.deskId;
      deskToken = registered.token;
      writeJson(stateFile("desk.json"), { deskId, token: encodeSecret(deskToken) });
      const saved = readJson<DeskTarget>(stateFile("target.json"), { kind: "cloud" });
      // Re-bind folders on this desk id. A local record is not enough: the
      // in-memory control plane forgets workspaces every restart.
      for (const item of boundWorkspaces()) {
        const bound = await bindWorkspace(item.folder).catch(() => undefined);
        if (bound && saved.folder && path.resolve(saved.folder) === path.resolve(bound.folder)) {
          saved.workspaceId = bound.id;
        }
      }
      writeJson(stateFile("target.json"), { ...saved, deskId });
      toRenderer("desk:target", { ...saved, deskId });
    } catch (error) {
      console.error("failed to register desk", error);
      return;
    }
  }
  if (inbox) {
    return;
  }
  inbox = openDeskInboxStream({
    baseUrl: controlPlaneUrl,
    deskId,
    deskToken,
    onEvent: (event) => void handleInboxEvent(event),
    onStateChange: (connected) => toRenderer("desk:inbox-state", { connected }),
    onUnauthorized: () => {
      // Local control plane is in-memory: a restart invalidates the saved
      // desk token. Drop it and register again instead of retrying 401s.
      deskId = "";
      deskToken = "";
      inbox?.close();
      inbox = null;
      void connectInbox();
    },
  });
}

function wireIpc(): void {
  const { ipcMain } = require("electron") as typeof import("electron");
  ipcMain.handle("desk:getToken", () => getToken());
  ipcMain.handle("desk:setToken", (_event, token: string) => {
    setToken(token);
    void connectInbox();
  });
  ipcMain.handle("desk:clearToken", () => {
    setToken("");
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
    writeJson(stateFile("target.json"), target);
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
      await createLeaseClient(controlPlaneUrl)
        .unbindWorkspace({ deskId, deskToken, workspaceId })
        .catch((error) => console.error("failed to unbind desk workspace", error));
    }
    return true;
  });
  ipcMain.handle("desk:getTarget", () => currentTarget());
  ipcMain.handle("desk:setTarget", (_event, target: DeskTarget) => {
    const bound = findBound({ folder: target.folder });
    writeJson(stateFile("target.json"), {
      ...target,
      deskId: target.deskId || deskId || undefined,
      workspaceId: bound?.id ?? target.workspaceId,
    });
  });
  ipcMain.handle("desk:getPrefs", () => ({ ...prefs(), deskId }));
  ipcMain.handle("desk:setPrefs", (_event, next: DeskPrefs) => {
    setPrefs(next);
    return prefs();
  });
  ipcMain.handle("desk:startRun", async (_event, assignment: DeskAssignment) => {
    await startAssignment(assignment);
    return true;
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
      return { error: error instanceof Error ? error.message : "读取失败" };
    }
  });
  ipcMain.handle("desk:diffStat", async (_event, folder: string) => {
    try {
      return await localWorkspaceDiffStat(folder);
    } catch {
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (existsSync(stateFile("desk.json"))) {
    const saved = readJson<{ deskId?: string; token?: string }>(stateFile("desk.json"), {});
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
    } catch {
      // tray icon is optional
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

app.on("before-quit", () => {
  inbox?.close();
  for (const shellSession of shells.values()) {
    shellSession.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
