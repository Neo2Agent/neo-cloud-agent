/**
 * Desk offline → same Remote run continues in the cloud.
 * Needs :8080 and :5173. Does not need Electron: claim is via the desk token API.
 */
import { chromium, type Page } from "../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ARTIFACT_DIR = "/opt/cursor/artifacts";
const API = process.env.NEO_E2E_API ?? "http://127.0.0.1:8080";
const WEB = process.env.NEO_E2E_WEB ?? "http://127.0.0.1:5173";

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-rc-cdp-"));
  spawnSync("git", ["init", "-b", "main"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "rc@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "RC"], { cwd: dir });
  writeFileSync(path.join(dir, "README.md"), "cdp\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  spawnSync("git", ["checkout", "-b", "feat/login"], { cwd: dir });
  writeFileSync(path.join(dir, "FEATURE.md"), "branch\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "feat"], { cwd: dir });
  return dir;
}

async function login(page: Page) {
  const gate = page.locator("#auth-gate:not([hidden]) #auth-form");
  if ((await gate.count()) === 0) return;
  await page.evaluate(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const user = document.querySelector("#auth-email");
    const pass = document.querySelector("#auth-password");
    if (!user || !pass || !set) return;
    set.call(user, "admin");
    user.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(pass, "123456");
    pass.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await page.locator("#auth-submit").click();
  await page.locator("#auth-gate:not([hidden])").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
}

async function shot(page: Page, name: string) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const dest = `${ARTIFACT_DIR}/${name}.png`;
  await page.screenshot({ path: dest, fullPage: false });
  return dest;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} ${res.status} ${body}`);
  }
  return JSON.parse(body) as T;
}

const repo = initRepo();
const session = await json<{ token: string }>(`${API}/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin", password: "123456" }),
});
const headers = { "content-type": "application/json", authorization: `Bearer ${session.token}` };
const registered = await json<{ desk: { id: string }; token: string }>(`${API}/v1/desks`, {
  method: "POST",
  headers,
  body: JSON.stringify({ name: "cdp-box", hostname: "cdp", platform: "linux" }),
});
const remote = await json<{ id: string; executionTarget?: { remoteControl?: boolean } }>(`${API}/v1/runs?client=desk`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    prompt: "CDP offline remote continue",
    repoUrls: [repo],
    source: "desk",
    start: "inline",
    kernel: "agentscope",
    target: { loop: "cloud", tools: "desk", deskId: registered.desk.id, remoteControl: true },
  }),
});
const claimed = await json<{ remoteUrl?: string; baseBranch?: string }>(`${API}/v1/desks/${registered.desk.id}/claim`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${registered.token}` },
  body: JSON.stringify({
    runId: remote.id,
    workspaceDir: repo,
    remoteUrl: "https://github.com/acme/app.git",
    branch: "feat/login",
  }),
});
if (claimed.remoteUrl !== "https://github.com/acme/app.git" || claimed.baseBranch !== "feat/login") {
  throw new Error(`claim did not record origin/branch: ${JSON.stringify(claimed)}`);
}

const chrome = await chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const web = await chrome.newPage({ viewport: { width: 1280, height: 800 } });
await web.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
await login(web);
await web.evaluate(`location.hash = "#/runs/${remote.id}"`);
await web.waitForTimeout(1200);
await shot(web, "rc-offline-before-continue");

const button = web.locator("#continue-remote-cloud");
if ((await button.count()) === 0) {
  throw new Error("continue-in-cloud button missing while Desk is offline");
}
await button.click();
await web.getByRole("button", { name: "在云端续聊" }).last().click();
await web.waitForTimeout(1500);
await shot(web, "rc-offline-after-continue");

const moved = await json<{
  id: string;
  executionTarget?: { loop?: string; tools?: string; remoteControl?: boolean };
  branchName?: string;
}>(`${API}/v1/runs/${remote.id}`, { headers });
if (moved.executionTarget?.tools !== "cloud" || moved.executionTarget?.remoteControl) {
  throw new Error(`run did not become cloud: ${JSON.stringify(moved.executionTarget)}`);
}
if ((await web.locator("#continue-remote-cloud").count()) > 0) {
  throw new Error("continue-in-cloud button still visible after handoff");
}

const local = await json<{ id: string }>(`${API}/v1/runs?client=desk`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    prompt: "this computer stays hidden",
    repoUrls: [repo],
    source: "desk",
    start: "inline",
    target: { loop: "desk", tools: "desk", deskId: registered.desk.id },
  }),
});
const listed = await json<{ runs: Array<{ id: string }> }>(`${API}/v1/runs`, { headers });
if (listed.runs.some((item) => item.id === local.id)) {
  throw new Error("This Computer run leaked into the web list");
}

writeFileSync(
  `${ARTIFACT_DIR}/rc-offline-cloud.json`,
  `${JSON.stringify({ remoteId: remote.id, tools: moved.executionTarget?.tools, branch: moved.branchName }, null, 2)}\n`,
);
await chrome.close();
console.log("ok", remote.id, moved.executionTarget?.tools);
