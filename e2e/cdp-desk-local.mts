/**
 * Live CDP harness for Desk local features + Remote Control three-client sync.
 *
 * Needs: control-plane :8080 (mock LLM), web :5173, mobile :5175,
 * desk vite :5174, Electron CDP :9222, neo-loop :8082 for Remote Control.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const API = "http://127.0.0.1:8080";
const WEB = "http://127.0.0.1:5173";
const MOBILE = "http://127.0.0.1:5175";
const DESK_CDP = "http://127.0.0.1:9222";
const EMAIL = "admin";
const PASSWORD = "123456";
const ART = "/opt/cursor/artifacts";
const OUT = `${ART}/cdp-desk-local-report.json`;
const WS = "/workspace/.tmp-cdp-desk-ws";

type Row = { id: string; group: string; ok: boolean; detail: string; ms: number };

const rows: Row[] = [];
const started = Date.now();

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function check(id: string, group: string, fn: () => Promise<string | void>): Promise<boolean> {
  const t0 = Date.now();
  try {
    const detail = (await fn()) || "ok";
    rows.push({ id, group, ok: true, detail: String(detail), ms: Date.now() - t0 });
    log(`PASS  ${id}  (${Date.now() - t0}ms)  ${detail}`);
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    rows.push({ id, group, ok: false, detail, ms: Date.now() - t0 });
    log(`FAIL  ${id}  (${Date.now() - t0}ms)  ${detail}`);
    return false;
  }
}

async function api(
  route: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${API}${route}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`expected object, got ${typeof value}: ${String(value).slice(0, 200)}`);
}

function mustStatus(got: number, want: number | number[], extra = ""): void {
  const ok = Array.isArray(want) ? want.includes(got) : got === want;
  if (!ok) {
    throw new Error(`HTTP ${got} expected ${Array.isArray(want) ? want.join("|") : want}${extra ? ` ${extra}` : ""}`);
  }
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 20_000,
  everyMs = 250,
): Promise<T> {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
      last = "empty";
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timeout ${label}: ${last}`);
}

async function loginApi(): Promise<string> {
  const res = await api("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  mustStatus(res.status, 200, res.text);
  const token = String(asRecord(res.json).token || "");
  if (!token) throw new Error("login returned no token");
  return token;
}

function prepareWorkspace(): void {
  mkdirSync(WS, { recursive: true });
  writeFileSync(path.join(WS, "README.md"), "# desk local cdp\n");
  if (!existsSync(path.join(WS, ".git"))) {
    execSync("git init && git add README.md && git -c user.email=cdp@neo.local -c user.name=cdp commit -m init", {
      cwd: WS,
      stdio: "ignore",
    });
  }
}

async function connectDeskElectron(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.connectOverCDP(DESK_CDP);
  const pages = browser.contexts().flatMap((ctx) => ctx.pages());
  const page = pages.find((p) => /5174|desk|neo-desk/i.test(p.url()) || p.url().startsWith("http")) ?? pages[0];
  if (!page) {
    await browser.close().catch(() => undefined);
    throw new Error("Electron has no page");
  }
  return { browser, page };
}

async function loginDesk(page: Page): Promise<void> {
  const form = page.locator(".login-form");
  if (await form.isVisible({ timeout: 2500 }).catch(() => false)) {
    await form.locator("input").nth(0).fill(EMAIL);
    await form.locator('input[type="password"]').fill(PASSWORD);
    await form.locator("button.login-continue, button[type=submit]").first().click();
    await form.waitFor({ state: "hidden", timeout: 15_000 });
  }
  await page.locator(".agents-app, #desk-composer, textarea").first().waitFor({ timeout: 15_000 });
}

async function loginWeb(page: Page): Promise<void> {
  await page.goto(WEB, { waitUntil: "domcontentloaded" });
  const gate = page.locator("#auth-gate");
  if (await gate.isVisible().catch(() => false)) {
    await page.locator("#auth-email").fill(EMAIL);
    await page.locator("#auth-password").fill(PASSWORD);
    await page.locator("#auth-submit").click();
    await gate.waitFor({ state: "hidden", timeout: 15_000 });
  }
  await page.locator("#composer").waitFor({ timeout: 15_000 });
}

async function loginMobile(page: Page): Promise<void> {
  await page.goto(MOBILE, { waitUntil: "domcontentloaded" });
  const account = page.locator('input[name="account"]');
  if (await account.isVisible({ timeout: 4000 }).catch(() => false)) {
    await account.fill(EMAIL);
    await page.locator('input[name="secret"]').fill(PASSWORD);
    await page.getByRole("button", { name: /Continue|登录/ }).click();
  }
  await page.locator("textarea.composer-field, #prompt, textarea").first().waitFor({ timeout: 15_000 });
}

async function goNewChat(page: Page): Promise<void> {
  await page.getByRole("button", { name: "新对话" }).click().catch(() => undefined);
  await page.locator("#desk-composer").waitFor({ timeout: 10_000 });
}

async function selectDeskTarget(page: Page, kind: "desk" | "remote"): Promise<void> {
  await page.locator("#desk-target").click();
  await page.locator(`[data-desk-target="${kind}"]`).click();
}

async function sendDeskPrompt(page: Page, text: string): Promise<void> {
  const box = page.locator("#desk-composer");
  await box.fill(text);
  await page.locator('button[aria-label="发送"]').click();
}

async function waitDeskRunByMarker(token: string, marker: string, timeoutMs = 25_000): Promise<string> {
  return waitFor(
    `desk run ${marker}`,
    async () => {
      const res = await api("/v1/runs?client=desk", { token });
      if (res.status !== 200) throw new Error(`${res.status}`);
      const payload = asRecord(res.json);
      const items = Array.isArray(payload.runs) ? payload.runs : [];
      const hit = (items as Array<Record<string, unknown>>).find((item) => String(item.prompt || "").includes(marker));
      return hit ? String(hit.id) : null;
    },
    timeoutMs,
  );
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(ART, { recursive: true });
  await page.screenshot({ path: `${ART}/${name}.png`, fullPage: false });
}

async function main(): Promise<void> {
  mkdirSync(ART, { recursive: true });
  prepareWorkspace();
  log(`cdp desk-local run @ ${new Date().toISOString()}`);

  let neoLoop = false;
  await check("env.health", "env", async () => {
    const res = await api("/health");
    mustStatus(res.status, 200);
    const h = asRecord(res.json);
    if (h.llmUpstream !== "mock") throw new Error(`llmUpstream=${String(h.llmUpstream)}`);
    const loop = asRecord(h.neoLoop ?? {});
    neoLoop = loop.available === true;
    return `neoLoop=${neoLoop} kernel=${String(h.agentKernel)}`;
  });

  const token = await loginApi();
  await check("api.auth.login", "auth", async () => `admin token`);

  const electron = await connectDeskElectron();
  const desk = electron.page;
  const chrome = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const web = await (await chrome.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" })).newPage();
  const mobile = await (
    await chrome.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", isMobile: true, hasTouch: true })
  ).newPage();

  let thisComputerId = "";
  let remoteId = "";
  let dispatchedId = "";

  try {
    await check("ui.desk.login", "desk-local", async () => {
      await loginDesk(desk);
      await shot(desk, "cdp-desk-local-home");
      return desk.url();
    });

    await check("ui.web.login", "sync", async () => {
      await loginWeb(web);
      return web.url();
    });

    await check("ui.mobile.login", "sync", async () => {
      await loginMobile(mobile);
      return mobile.url();
    });

    await check("desk.settings.local-toggles", "desk-local", async () => {
      await desk.getByRole("button", { name: "Settings" }).click();
      await desk.getByRole("button", { name: "基础配置" }).click();
      const body = await desk.locator(".settings-card").innerText();
      if (!/同时最多几条本机对话/.test(body)) throw new Error(body.slice(0, 200));
      if (!/允许网页和手机在这台电脑开对话/.test(body)) throw new Error("missing allowRemote");
      if (!/远程派活先确认/.test(body)) throw new Error("missing requireApproval");
      const remote = desk.locator("#toggle-allow-remote");
      if ((await remote.getAttribute("aria-checked")) !== "true") await remote.click();
      const approve = desk.locator("#toggle-require-approval");
      if ((await approve.getAttribute("aria-checked")) === "true") await approve.click();
      await shot(desk, "cdp-desk-local-settings");
      return "toggles on";
    });

    await check("desk.authorizeFolder", "desk-local", async () => {
      const result = await desk.evaluate(
        async (folder) => {
          const bridge = (window as unknown as { neoDesk?: { authorizeFolder?: (p: string) => Promise<unknown> } }).neoDesk;
          if (!bridge?.authorizeFolder) return { error: "authorizeFolder missing — restart Electron" };
          return bridge.authorizeFolder(folder);
        },
        WS,
        { timeout: 15_000 },
      );
      const rec = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
      if (rec.error) throw new Error(String(rec.error));
      if (!rec.folder && !rec.id) throw new Error(JSON.stringify(result));
      return String(rec.folder || rec.id);
    });

    await check("desk.this-computer.create", "desk-local", async () => {
      await goNewChat(desk);
      await selectDeskTarget(desk, "desk");
      const marker = `TC${Date.now().toString().slice(-6)}`;
      await sendDeskPrompt(desk, `${marker} 只回复一个词：pong。不要调用工具。`);
      const id = await waitDeskRunByMarker(token, marker);
      thisComputerId = id;
      await waitFor("desk hash or transcript", async () => {
        const hash = new URL(desk.url()).hash;
        if (hash.includes(id)) return "hash";
        const body = await desk.locator("body").innerText();
        return body.includes(marker) ? "body" : null;
      }, 20_000);
      const run = await waitFor("this-computer target", async () => {
        const res = await api(`/v1/runs/${id}?client=desk`, { token });
        if (res.status !== 200) throw new Error(`${res.status} ${res.text}`);
        const body = asRecord(res.json);
        const target = asRecord(body.executionTarget ?? {});
        if (target.loop !== "desk" || target.tools !== "desk") return null;
        return `${String(body.status)} loop=${String(target.loop)}`;
      }, 25_000);
      await shot(desk, "cdp-desk-this-computer");
      return `${id} ${run} marker=${marker}`;
    });

    await check("desk.this-computer.hidden-from-web", "sync", async () => {
      if (!thisComputerId) throw new Error("no this-computer run");
      const listed = await api("/v1/runs", { token });
      mustStatus(listed.status, 200);
      const payload = asRecord(listed.json);
      const items = Array.isArray(payload.runs) ? payload.runs : Array.isArray(listed.json) ? listed.json : [];
      const hit = (items as Array<Record<string, unknown>>).some((item) => item.id === thisComputerId);
      if (hit) throw new Error("This Computer run leaked into the default list");
      return "hidden";
    });

    await check("desk.files.tree", "desk-local", async () => {
      await desk.getByRole("button", { name: "打开右侧栏" }).click().catch(() => undefined);
      const filesBtn = desk.getByRole("button", { name: "打开 Files" }).or(desk.getByText("File", { exact: true }));
      await filesBtn.first().click({ timeout: 8_000 });
      const seen = await waitFor("readme in files", async () => {
        const body = await desk.locator("body").innerText();
        return /README\.md/.test(body) ? "README.md" : null;
      }, 12_000);
      await shot(desk, "cdp-desk-local-files");
      return seen;
    });

    await check("desk.terminal.echo", "desk-local", async () => {
      await desk.getByRole("button", { name: "打开右侧栏" }).click().catch(() => undefined);
      const termBtn = desk.getByRole("button", { name: "打开 Terminal" }).or(desk.getByText("Terminal", { exact: true }));
      await termBtn.first().click({ timeout: 8_000 });
      await desk.getByRole("button", { name: "新终端" }).click().catch(() => undefined);
      const input = desk.locator('[aria-label="终端输入"], textarea, .wb-term input').first();
      await input.waitFor({ timeout: 8_000 });
      await input.fill("echo desk-local-term");
      await input.press("Enter");
      const seen = await waitFor("term echo", async () => {
        const body = await desk.locator("body").innerText();
        return /desk-local-term/.test(body) ? "echoed" : null;
      }, 12_000);
      await shot(desk, "cdp-desk-local-term");
      return seen;
    });

    await check("desk.ipc.listDir", "desk-local", async () => {
      const listing = await desk.evaluate(async (folder) => {
        const bridge = (window as unknown as { neoDesk?: { listDir?: (i: { folder: string }) => Promise<{ entries?: Array<{ name: string }> }> } }).neoDesk;
        if (!bridge?.listDir) return { error: "listDir missing" };
        return bridge.listDir({ folder });
      }, WS);
      const rec = listing as { entries?: Array<{ name: string }>; error?: string };
      if (rec.error) throw new Error(rec.error);
      const names = (rec.entries ?? []).map((item) => item.name);
      if (!names.includes("README.md")) throw new Error(`entries=${names.join(",")}`);
      return names.slice(0, 8).join(",");
    });

    await check("api.desks.catalog", "remote", async () => {
      const seen = await waitFor("desk catalog published", async () => {
        const res = await api("/v1/desks", { token });
        if (res.status !== 200) throw new Error(`${res.status} ${res.text}`);
        const desks = (asRecord(res.json).desks ?? []) as Array<Record<string, unknown>>;
        const live = desks.find((item) => item.online === true && item.allowRemote === true);
        if (!live) return null;
        const workspaces = (live.workspaces ?? []) as Array<Record<string, unknown>>;
        if (workspaces.length === 0) return null;
        return `${String(live.id)} ws=${workspaces.length} name=${String(workspaces[0]?.name || "")}`;
      }, 20_000);
      return seen;
    });

    if (neoLoop) {
      await check("desk.remote-control.create", "remote", async () => {
        await goNewChat(desk);
        await selectDeskTarget(desk, "remote");
        const marker = `RC${Date.now().toString().slice(-6)}`;
        await sendDeskPrompt(desk, `${marker} 只回复一个词：pong。不要调用工具。`);
        const id = await waitDeskRunByMarker(token, marker, 30_000);
        remoteId = id;
        await waitFor("remote on desk", async () => {
          const hash = new URL(desk.url()).hash;
          if (hash.includes(id)) return "hash";
          const body = await desk.locator("body").innerText();
          return body.includes(marker) ? "body" : null;
        }, 20_000);
        const target = await waitFor("remote target", async () => {
          const res = await api(`/v1/runs/${id}`, { token });
          if (res.status !== 200) throw new Error(`${res.status}`);
          const body = asRecord(res.json);
          const t = asRecord(body.executionTarget ?? {});
          if (t.remoteControl !== true || t.loop !== "cloud" || t.tools !== "desk") return null;
          return String(body.status);
        }, 30_000);
        await shot(desk, "cdp-desk-remote-control");
        return `${id} ${target} ${marker}`;
      });

      await check("remote.visible-on-web", "sync", async () => {
        if (!remoteId) throw new Error("no remote run");
        await web.goto(`${WEB}/#/runs/${remoteId}`, { waitUntil: "domcontentloaded" });
        const seen = await waitFor("web opens remote", async () => {
          const t = await web.locator("#transcript, body").first().innerText();
          return /RC|pong|Remote/.test(t) ? t.slice(0, 80) : null;
        }, 20_000);
        await shot(web, "cdp-web-remote-run");
        return seen;
      });

      await check("remote.visible-on-mobile", "sync", async () => {
        if (!remoteId) throw new Error("no remote run");
        await mobile.goto(`${MOBILE}/#/runs/${remoteId}`, { waitUntil: "domcontentloaded" });
        const seen = await waitFor("mobile opens remote", async () => {
          const t = await mobile.locator("body").innerText();
          return /RC|pong|Remote/.test(t) ? t.slice(0, 80) : null;
        }, 20_000);
        await shot(mobile, "cdp-mobile-remote-run");
        return seen;
      });

      const follow = `RF${Date.now().toString().slice(-5)}`;
      await check("remote.follow-up-from-web", "sync", async () => {
        if (!remoteId) throw new Error("no remote run");
        await waitFor("remote idle enough", async () => {
          const res = await api(`/v1/runs/${remoteId}`, { token });
          const st = String(asRecord(res.json).status);
          return ["IDLE", "DONE", "SUCCEEDED", "RUNNING"].includes(st) ? st : null;
        }, 40_000);
        const res = await api(`/v1/runs/${remoteId}/follow-ups`, {
          method: "POST",
          token,
          body: JSON.stringify({ text: `再回复一个词：ping。${follow}` }),
        });
        mustStatus(res.status, [200, 201], res.text);
        return follow;
      });

      await check("remote.follow-up-on-desk", "sync", async () => {
        const seen = await waitFor("desk sees follow-up", async () => {
          const t = await desk.locator("body").innerText();
          return t.includes(follow) ? "visible" : null;
        }, 25_000);
        return seen;
      });

      await check("remote.follow-up-on-mobile", "sync", async () => {
        const seen = await waitFor("mobile sees follow-up", async () => {
          const t = await mobile.locator("body").innerText();
          return t.includes(follow) ? "visible" : null;
        }, 25_000);
        return seen;
      });

      await check("web.dispatch-to-desk", "remote", async () => {
        const desksRes = await api("/v1/desks", { token });
        const desks = (asRecord(desksRes.json).desks ?? []) as Array<Record<string, unknown>>;
        const live = desks.find((item) => item.online === true && item.allowRemote === true);
        const ws = ((live?.workspaces ?? []) as Array<Record<string, unknown>>)[0];
        if (!live || !ws) throw new Error("no published desk workspace");
        const marker = `WD${Date.now().toString().slice(-6)}`;
        const res = await api("/v1/runs", {
          method: "POST",
          token,
          body: JSON.stringify({
            prompt: `${marker} 只回复一个词：pong。不要调用工具。`,
            repoUrls: [],
            skipRepoDefaults: true,
            source: "web",
            deskWorkspaceId: ws.id,
            target: {
              loop: "cloud",
              tools: "desk",
              deskId: live.id,
              deskWorkspaceId: ws.id,
              remoteControl: true,
            },
          }),
        });
        mustStatus(res.status, [200, 201], res.text);
        dispatchedId = String(asRecord(res.json).id || "");
        if (!dispatchedId) throw new Error("no dispatched id");
        const startedRun = await waitFor("dispatched claimed", async () => {
          const got = await api(`/v1/runs/${dispatchedId}`, { token });
          const st = String(asRecord(got.json).status);
          if (st === "ERROR") throw new Error(`ERROR ${JSON.stringify(got.json).slice(0, 200)}`);
          return ["RUNNING", "IDLE", "DONE", "SUCCEEDED"].includes(st) ? st : null;
        }, 40_000);
        await shot(desk, "cdp-desk-web-dispatch");
        return `${dispatchedId} ${startedRun}`;
      });

      await check("web.dispatch.visible-three-clients", "sync", async () => {
        if (!dispatchedId) throw new Error("no dispatched run");
        await web.goto(`${WEB}/#/runs/${dispatchedId}`, { waitUntil: "domcontentloaded" });
        await mobile.goto(`${MOBILE}/#/runs/${dispatchedId}`, { waitUntil: "domcontentloaded" });
        await desk.goto(desk.url().replace(/#.*$/, "") + `#/runs/${dispatchedId}`).catch(() => undefined);
        const webOk = await waitFor("web dispatch transcript", async () => {
          const t = await web.locator("#transcript, body").first().innerText();
          return /WD|pong/.test(t) ? "web" : null;
        }, 20_000);
        return webOk;
      });
    } else {
      await check("desk.remote-control.skipped", "remote", async () => {
        throw new Error("neo-loop unavailable — Remote Control cannot run");
      });
    }
  } finally {
    await chrome.close().catch(() => undefined);
    await electron.browser.close().catch(() => undefined);
  }

  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.filter((r) => !r.ok);
  const report = {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    passed,
    failed: failed.length,
    thisComputerId,
    remoteId,
    dispatchedId,
    rows,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  log(`\n${passed} passed, ${failed.length} failed, ${rows.length} total  → ${OUT}`);
  if (failed.length) {
    for (const row of failed) log(`  - ${row.id}: ${row.detail}`);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

void main();
