import { app, BrowserWindow, Menu, Notification, Tray, dialog, net, powerSaveBlocker, protocol, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLeaseClient } from "../src/lease.js";
import { controlPlaneOrigin, deskRendererUrl } from "../src/ports.js";
import { hashForRun, runIdFromDeepLink } from "../src/protocol.js";
import { deskRepoRoot, spawnDeskWorker } from "../src/spawn.js";
import { isGitRepo, prepareDeskWorkspace, writeRunBootstrap } from "../src/workspace.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "neo-desk",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

type DeskTarget = { kind: "cloud" | "desk" | "remote"; folder?: string; deskId?: string };

const controlPlaneUrl = controlPlaneOrigin();
const rendererUrl = deskRendererUrl() || controlPlaneUrl;
const stateDir = () => path.join(app.getPath("userData"), "neo-desk");
const stateFile = (name: string) => path.join(stateDir(), name);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let sleepBlocker = 0;
let deskId = "";
let deskToken = "";
let leaseLoop = false;

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

function authorizedFolders(): string[] {
  return readJson<string[]>(stateFile("folders.json"), []);
}

function rememberFolder(folder: string): void {
  writeJson(stateFile("folders.json"), [...new Set([...authorizedFolders(), folder])]);
}

function webDist(): string {
  return path.join(deskRepoRoot(), "packages/web/dist");
}

function registerRendererProtocol(): void {
  protocol.handle("neo-desk", (request) => {
    const dist = webDist();
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
  if (process.env.NEO_DESK_URL) {
    return deskRendererUrl();
  }
  if (existsSync(path.join(webDist(), "index.html"))) {
    return "neo-desk://app/";
  }
  return rendererUrl;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Neo Desk",
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
  void mainWindow.loadURL(rendererEntry());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function confirmFolder(folder: string): Promise<boolean> {
  if (authorizedFolders().includes(folder)) {
    return true;
  }
  const result = await dialog.showMessageBox({
    type: "warning",
    buttons: ["允许", "取消"],
    defaultId: 1,
    cancelId: 1,
    title: "授权本机文件夹",
    message: "Agent 会在这个 git 仓库里跑命令、改文件。",
    detail: folder,
  });
  if (result.response !== 0) {
    return false;
  }
  rememberFolder(folder);
  return true;
}

async function startLeaseLoop(): Promise<void> {
  if (leaseLoop) {
    return;
  }
  const userToken = getToken();
  if (!userToken) {
    return;
  }
  const client = createLeaseClient(controlPlaneUrl);
  if (!deskId || !deskToken) {
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
    writeJson(stateFile("target.json"), { ...saved, deskId });
  }
  leaseLoop = true;
  const tick = async () => {
    if (!leaseLoop) {
      return;
    }
    try {
      const assignment = await client.waitAssignment({ deskId, deskToken, waitMs: 20_000 });
      if (!assignment) {
        setTimeout(() => void tick(), 250);
        return;
      }
      const target = readJson<DeskTarget>(stateFile("target.json"), { kind: "desk" });
      const folder = target.folder;
      if (!folder || !isGitRepo(folder) || !(await confirmFolder(folder))) {
        setTimeout(() => void tick(), 1000);
        return;
      }
      const workspaceDir = await prepareDeskWorkspace({ repoDir: folder, runId: assignment.runId });
      writeRunBootstrap(workspaceDir, {
        runId: assignment.runId,
        controlPlaneUrl: assignment.controlPlaneUrl,
        llmGatewayUrl: assignment.llmGatewayUrl,
        jwt: assignment.jwt,
        model: assignment.model,
      });
      if (!sleepBlocker) {
        sleepBlocker = powerSaveBlocker.start("prevent-app-suspension");
      }
      const child = spawnDeskWorker({
        runId: assignment.runId,
        jwt: assignment.jwt,
        controlPlaneUrl: assignment.controlPlaneUrl,
        llmGatewayUrl: assignment.llmGatewayUrl,
        workspaceDir,
        model: assignment.model,
      });
      await client.claim({
        deskId,
        deskToken,
        runId: assignment.runId,
        workspaceDir,
        pid: child.pid ?? undefined,
      });
      child.stdout?.on("data", (chunk) => process.stdout.write(`[desk-worker ${assignment.runId}] ${chunk}`));
      child.stderr?.on("data", (chunk) => process.stderr.write(`[desk-worker ${assignment.runId}] ${chunk}`));
      child.on("exit", () => {
        if (sleepBlocker && powerSaveBlocker.isStarted(sleepBlocker)) {
          powerSaveBlocker.stop(sleepBlocker);
          sleepBlocker = 0;
        }
      });
    } catch (error) {
      console.error("desk lease loop", error);
    }
    setTimeout(() => void tick(), 400);
  };
  void tick();
}

function wireIpc(): void {
  const { ipcMain } = require("electron") as typeof import("electron");
  ipcMain.handle("desk:getToken", () => getToken());
  ipcMain.handle("desk:setToken", (_event, token: string) => {
    setToken(token);
    void startLeaseLoop();
  });
  ipcMain.handle("desk:clearToken", () => setToken(""));
  ipcMain.handle("desk:pickFolder", async () => {
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const folder = picked.filePaths[0];
    if (!folder) {
      return null;
    }
    if (!isGitRepo(folder)) {
      await dialog.showErrorBox("需要 git 仓库", "本机执行只允许 git 仓库文件夹。");
      return null;
    }
    if (!(await confirmFolder(folder))) {
      return null;
    }
    const target = { kind: "desk" as const, folder, deskId };
    writeJson(stateFile("target.json"), target);
    return folder;
  });
  ipcMain.handle("desk:getTarget", () => {
    const saved = readJson<DeskTarget>(stateFile("target.json"), { kind: "cloud" });
    return { ...saved, deskId: saved.deskId || deskId || undefined };
  });
  ipcMain.handle("desk:setTarget", (_event, target: DeskTarget) => {
    writeJson(stateFile("target.json"), { ...target, deskId: target.deskId || deskId || undefined });
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
}

app.whenReady().then(() => {
  if (existsSync(stateFile("desk.json"))) {
    const saved = readJson<{ deskId?: string; token?: string }>(stateFile("desk.json"), {});
    deskId = saved.deskId ?? "";
    deskToken = saved.token ? decodeSecret(saved.token) : "";
  }
  if (existsSync(path.join(webDist(), "index.html"))) {
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
  void startLeaseLoop();
  app.setAsDefaultProtocolClient("neo");
});

app.on("open-url", (_event, url) => {
  const runId = runIdFromDeepLink(url);
  if (runId && mainWindow) {
    void mainWindow.loadURL(`${rendererEntry().replace(/\/$/, "")}/${hashForRun(runId)}`);
    mainWindow.webContents.send("desk:deep-link", url);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
