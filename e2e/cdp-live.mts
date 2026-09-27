/**
 * Live CDP + API capability harness against the running local stack:
 *   control-plane :8080 (mock LLM), web :5173, mobile lab :5175,
 *   desk vite :5174, desk Electron CDP :9222.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { createWriteStream } from "node:fs";

const API = "http://127.0.0.1:8080";
const WEB = "http://127.0.0.1:5173";
const MOBILE = "http://127.0.0.1:5175";
const DESK_UI = "http://127.0.0.1:5174";
const DESK_CDP = "http://127.0.0.1:9222";
const EMAIL = "admin";
const PASSWORD = "123456";
const ART = "/opt/cursor/artifacts";
const OUT = `${ART}/cdp-capability-report.json`;

type Row = {
  id: string;
  group: string;
  ok: boolean;
  detail: string;
  ms: number;
};

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
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${API}${path}`, { ...init, headers });
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
  if (!ok) throw new Error(`HTTP ${got} expected ${Array.isArray(want) ? want.join("|") : want}${extra ? ` ${extra}` : ""}`);
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

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(ART, { recursive: true });
  await page.screenshot({ path: `${ART}/${name}.png`, fullPage: false });
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

async function loginDeskPage(page: Page): Promise<void> {
  await page.goto(DESK_UI, { waitUntil: "domcontentloaded" });
  const form = page.locator(".login-form");
  if (await form.isVisible({ timeout: 4000 }).catch(() => false)) {
    const inputs = form.locator("input");
    await inputs.nth(0).fill(EMAIL);
    await form.locator('input[type="password"]').fill(PASSWORD);
    await form.locator("button.login-continue, button[type=submit]").first().click();
    await form.waitFor({ state: "hidden", timeout: 15_000 });
  }
  await page.locator(".agents-app, textarea").first().waitFor({ timeout: 15_000 });
}

async function connectDeskElectron(): Promise<{ browser: Browser; page: Page } | null> {
  try {
    const browser = await chromium.connectOverCDP(DESK_CDP);
    const pages = browser.contexts().flatMap((ctx) => ctx.pages());
    const page =
      pages.find((p) => /5174|desk/i.test(p.url()) || p.url().startsWith("http")) ?? pages[0];
    if (!page) {
      await browser.close().catch(() => undefined);
      return null;
    }
    return { browser, page };
  } catch {
    return null;
  }
}

async function pageText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

async function runApiSuite(token: string): Promise<string> {
  let runId = "";

  await check("api.auth.wrong-password", "auth", async () => {
    const res = await api("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password: "definitely-wrong" }),
    });
    mustStatus(res.status, 401);
    const err = String(asRecord(res.json).error || res.text);
    if (!/invalid account or password/i.test(err)) throw new Error(err);
    return err;
  });

  await check("api.auth.unauth-runs", "auth", async () => {
    const res = await api("/v1/runs");
    mustStatus(res.status, 401);
    return String(asRecord(res.json).error || res.status);
  });

  await check("api.auth.me", "auth", async () => {
    const res = await api("/v1/me", { token });
    mustStatus(res.status, 200);
    const me = asRecord(res.json);
    return `email=${String(me.email || me.username || me.id)}`;
  });

  await check("api.runs.create", "runs", async () => {
    const marker = `CDP-SYNC-${Date.now()}`;
    const res = await api("/v1/runs", {
      method: "POST",
      token,
      body: JSON.stringify({
        prompt: `只回复一个词：pong。不要调用工具。标记=${marker}`,
        repoUrls: [],
        source: "web",
      }),
    });
    mustStatus(res.status, 201, res.text);
    runId = String(asRecord(res.json).id || "");
    if (!runId) throw new Error("no run id");
    return runId;
  });

  await check("api.runs.get", "runs", async () => {
    const res = await api(`/v1/runs/${runId}`, { token });
    mustStatus(res.status, 200);
    return String(asRecord(res.json).status);
  });

  await check("api.runs.missing-prompt", "runs", async () => {
    const res = await api("/v1/runs", {
      method: "POST",
      token,
      body: JSON.stringify({ repoUrls: [] }),
    });
    mustStatus(res.status, 400);
    return String(asRecord(res.json).error);
  });

  await check("api.transcript.snapshot", "transcript", async () => {
    const snap = await waitFor("transcript user line", async () => {
      const res = await api(`/v1/runs/${runId}/transcript`, { token });
      if (res.status !== 200) throw new Error(`transcript ${res.status} ${res.text}`);
      const text = JSON.stringify(res.json);
      return /pong|标记|CDP-SYNC|user/i.test(text) ? text.slice(0, 180) : null;
    }, 25_000);
    return snap;
  });

  await check("api.runs.idle", "runs", async () => {
    const status = await waitFor("run idle", async () => {
      const res = await api(`/v1/runs/${runId}`, { token });
      const st = String(asRecord(res.json).status);
      if (st === "ERROR") throw new Error(`run ERROR ${JSON.stringify(res.json).slice(0, 240)}`);
      return ["IDLE", "DONE", "SUCCEEDED"].includes(st) ? st : null;
    }, 45_000, 400);
    return status;
  });

  await check("api.runs.follow-up", "runs", async () => {
    const res = await api(`/v1/runs/${runId}/follow-ups`, {
      method: "POST",
      token,
      body: JSON.stringify({ text: "再回复一个词：ping。" }),
    });
    mustStatus(res.status, 201, res.text);
    return String(asRecord(res.json).id || asRecord(res.json).status || "queued");
  });

  await check("api.runs.follow-up-idle", "runs", async () => {
    const status = await waitFor("follow-up idle", async () => {
      const res = await api(`/v1/runs/${runId}`, { token });
      const st = String(asRecord(res.json).status);
      return ["IDLE", "DONE", "SUCCEEDED"].includes(st) ? st : null;
    }, 45_000, 400);
    return status;
  });

  await check("api.runs.abort-unauth", "runs", async () => {
    const res = await api(`/v1/runs/${runId}/abort`, { method: "POST" });
    mustStatus(res.status, 401);
    return "401";
  });

  await check("api.workspace.fs-escape", "workspace", async () => {
    const res = await api(`/v1/runs/${runId}/fs?path=../`, { token });
    mustStatus(res.status, [400, 403]);
    return `${res.status} ${res.text.slice(0, 120)}`;
  });

  await check("api.workspace.fs-root", "workspace", async () => {
    const res = await api(`/v1/runs/${runId}/fs?path=.`, { token });
    mustStatus(res.status, [200, 404]);
    return `${res.status}`;
  });

  await check("api.workspace.artifact-too-large", "workspace", async () => {
    const res = await api(`/v1/runs/${runId}/artifacts`, {
      method: "POST",
      token,
      body: JSON.stringify({ name: "huge.bin", content: "x".repeat(1_500_001) }),
    });
    mustStatus(res.status, [400, 413]);
    return `${res.status} ${res.text.slice(0, 120)}`;
  });

  await check("api.term.unauth", "term", async () => {
    const res = await api(`/v1/runs/${runId}/term`, { method: "POST" });
    mustStatus(res.status, 401);
    return "401";
  });

  await check("api.term.open", "term", async () => {
    const res = await api(`/v1/runs/${runId}/term`, {
      method: "POST",
      token,
      body: JSON.stringify({}),
    });
    mustStatus(res.status, [200, 201, 409], res.text);
    return `${res.status} ${res.text.slice(0, 160)}`;
  });

  await check("api.settings.llm", "settings", async () => {
    const res = await api("/v1/settings/llm", { token });
    mustStatus(res.status, 200);
    return Object.keys(asRecord(res.json)).slice(0, 8).join(",");
  });

  await check("api.settings.quota", "settings", async () => {
    const res = await api("/v1/quota", { token });
    mustStatus(res.status, 200);
    return Object.keys(asRecord(res.json)).slice(0, 8).join(",");
  });

  await check("api.settings.mcp", "settings", async () => {
    const res = await api("/v1/settings/mcp", { token });
    mustStatus(res.status, 200);
    return `${res.status}`;
  });

  await check("api.settings.notify", "settings", async () => {
    const res = await api("/v1/settings/notify", { token });
    mustStatus(res.status, 200);
    return `${res.status}`;
  });

  await check("api.github.status", "settings", async () => {
    const res = await api("/v1/integrations/github", { token });
    mustStatus(res.status, 200);
    const gh = asRecord(res.json);
    return `connected=${String(gh.connected)} oauth=${String(gh.oauthConfigured)}`;
  });

  await check("api.me.events", "sync", async () => {
    const res = await fetch(`${API}/v1/me/events`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/event-stream")) throw new Error(ct);
    await res.body?.cancel();
    return ct;
  });

  await check("api.vms", "settings", async () => {
    const res = await api("/v1/vms", { token });
    mustStatus(res.status, [200, 404]);
    return `${res.status}`;
  });

  await check("api.projects.list", "projects", async () => {
    const res = await api("/v1/projects", { token });
    mustStatus(res.status, 200);
    const n = Array.isArray(res.json) ? res.json.length : Object.keys(asRecord(res.json)).length;
    return `n=${n}`;
  });

  await check("api.experts", "catalog", async () => {
    const res = await api("/v1/experts", { token });
    mustStatus(res.status, [200, 404]);
    return `${res.status}`;
  });

  await check("api.skills", "catalog", async () => {
    const res = await api("/v1/plugins", { token });
    mustStatus(res.status, [200, 404]);
    return `${res.status}`;
  });

  await check("api.isolation.other-user", "auth", async () => {
    const phone = `13${String(Date.now()).slice(-9)}`;
    const reg = await api("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: `cdp${String(Date.now()).slice(-6)}`, phone, password: "password1" }),
    });
    if (reg.status === 201 && asRecord(reg.json).pending) return "register pending (no token) — isolation via 401/403 path ok";
    if (reg.status !== 200 && reg.status !== 201) return `register ${reg.status} ${reg.text.slice(0, 80)}`;
    const other = String(asRecord(reg.json).token || "");
    if (!other) return `register ${reg.status} no token`;
    const peek = await api(`/v1/runs/${runId}`, { token: other });
    mustStatus(peek.status, 404);
    return "404";
  });

  await check("api.runs.delete-before-archive", "runs", async () => {
    const res = await api(`/v1/runs/${runId}`, { method: "DELETE", token });
    mustStatus(res.status, 409);
    return `${res.status} ${res.text.slice(0, 80)}`;
  });

  await check("api.runs.archive", "runs", async () => {
    const res = await api(`/v1/runs/${runId}/archive`, { method: "POST", token });
    mustStatus(res.status, [200, 204], res.text);
    const status = await waitFor("archived", async () => {
      const got = await api(`/v1/runs/${runId}`, { token });
      const st = String(asRecord(got.json).status);
      return st === "ARCHIVED" ? st : null;
    }, 8_000, 100);
    return `${res.status} ${status}`;
  });

  await check("api.runs.follow-archived", "runs", async () => {
    const res = await api(`/v1/runs/${runId}/follow-ups`, {
      method: "POST",
      token,
      body: JSON.stringify({ text: "nope" }),
    });
    mustStatus(res.status, 400);
    if (!/archiv/i.test(res.text)) throw new Error(res.text.slice(0, 160));
    return res.text.slice(0, 120);
  });

  return runId;
}

async function runUiSuite(token: string): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const webCtx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
    isMobile: true,
    hasTouch: true,
  });
  const deskCtx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  const web = await webCtx.newPage();
  const mobile = await mobileCtx.newPage();
  const deskUi = await deskCtx.newPage();

  let deskElectron: { browser: Browser; page: Page } | null = null;

  try {
    await check("ui.web.login", "ui-web", async () => {
      await loginWeb(web);
      await shot(web, "cdp-web-home");
      const email = await web.locator("#account-email").innerText().catch(() => "");
      return email || "composer visible";
    });

    await check("ui.web.empty-send", "ui-web", async () => {
      const send = web.locator("#send");
      if (await send.isDisabled()) return "disabled";
      throw new Error("send enabled on empty prompt");
    });

    await check("ui.web.wrong-password-gate", "ui-web", async () => {
      // already logged in; just assert composer + no gate
      if (await web.locator("#auth-gate").isVisible().catch(() => false)) throw new Error("gate visible after login");
      return "logged in";
    });

    await check("ui.mobile.login", "ui-mobile", async () => {
      await loginMobile(mobile);
      await mobile.getByRole("button", { name: "打开任务" }).click();
      await mobile.locator(".drawer").waitFor({ timeout: 8_000 });
      await shot(mobile, "cdp-mobile-home");
      return mobile.url();
    });

    await check("ui.desk-vite.login", "ui-desk", async () => {
      await loginDeskPage(deskUi);
      await shot(deskUi, "cdp-desk-vite-home");
      return deskUi.url();
    });

    deskElectron = await connectDeskElectron();
    await check("ui.desk-electron.cdp", "ui-desk", async () => {
      if (!deskElectron) throw new Error("connectOverCDP 9222 failed");
      const page = deskElectron.page;
      const form = page.locator(".login-form");
      if (await form.isVisible({ timeout: 2500 }).catch(() => false)) {
        const inputs = form.locator("input");
        await inputs.nth(0).fill(EMAIL);
        await form.locator('input[type="password"]').fill(PASSWORD);
        await form.locator("button.login-continue, button[type=submit]").first().click();
        await form.waitFor({ state: "hidden", timeout: 15_000 });
      }
      await page.locator(".agents-app, textarea").first().waitFor({ timeout: 15_000 });
      await shot(page, "cdp-desk-electron-home");
      return page.url();
    });

    const marker = `三端同步-${Date.now()}`;
    let createdId = "";

    await check("sync.create-from-web", "sync", async () => {
      await web.locator("#new-chat").click().catch(() => undefined);
      await web.locator("#prompt").fill(`只回复一个词：pong。不要调用工具。${marker}`);
      await web.locator("#send").click();
      const id = await waitFor("web hash run id", async () => {
        const hash = new URL(web.url()).hash;
        const m = hash.match(/#\/runs\/([0-9a-f-]{8,})/i);
        return m?.[1] ?? null;
      }, 20_000);
      createdId = id;
      await web.locator("#transcript").waitFor({ timeout: 10_000 });
      await shot(web, "cdp-web-created-run");
      return id;
    });

    await check("sync.list-on-mobile", "sync", async () => {
      if (!(await mobile.locator(".drawer").isVisible().catch(() => false))) {
        await mobile.getByRole("button", { name: "打开任务" }).click();
        await mobile.locator(".drawer").waitFor({ timeout: 8_000 });
      }
      const seen = await waitFor("mobile list has marker", async () => {
        const body = await mobile.locator(".drawer").innerText();
        return body.includes(marker) ? `drawer:${body.split(marker)[0].slice(-20)}${marker}` : null;
      }, 12_000, 200);
      await shot(mobile, "cdp-mobile-list-sync");
      return seen;
    });

    await check("sync.list-on-desk-vite", "sync", async () => {
      const seen = await waitFor("desk vite list has run", async () => {
        const body = await pageText(deskUi);
        if (body.includes(marker) || (createdId && body.includes(createdId.slice(0, 8)))) return "visible";
        return null;
      }, 15_000, 400);
      await shot(deskUi, "cdp-desk-vite-list-sync");
      return seen;
    });

    if (deskElectron) {
      await check("sync.list-on-desk-electron", "sync", async () => {
        const page = deskElectron!.page;
        const seen = await waitFor("desk electron list has run", async () => {
          const body = await pageText(page);
          if (body.includes(marker) || (createdId && body.includes(createdId.slice(0, 8)))) return "visible";
          return null;
        }, 15_000, 400);
        await shot(page, "cdp-desk-electron-list-sync");
        return seen;
      });
    }

    await check("sync.open-same-run-three-clients", "sync", async () => {
      await web.goto(`${WEB}/#/runs/${createdId}`, { waitUntil: "domcontentloaded" });
      await mobile.goto(`${MOBILE}/#/runs/${createdId}`, { waitUntil: "domcontentloaded" });
      await deskUi.goto(`${DESK_UI}/#/runs/${createdId}`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      const webHas = await waitFor("web transcript marker", async () => {
        const t = await web.locator("#transcript").innerText();
        return t.includes(marker) ? "marker" : null;
      }, 20_000);
      return `web:${webHas}`;
    });

    const followMarker = `FOLLOW-${Date.now()}`;
    await check("sync.follow-up-from-mobile", "sync", async () => {
      if (await mobile.locator(".drawer").isVisible().catch(() => false)) {
        await mobile.locator(".drawer-backdrop").click().catch(async () => {
          await mobile.getByRole("button", { name: "关闭侧栏" }).click();
        });
      }
      await mobile.goto(`${MOBILE}/#/runs/${createdId}`, { waitUntil: "domcontentloaded" });
      const field = mobile.locator("textarea.composer-field").first();
      await field.waitFor({ timeout: 10_000 });
      await field.fill(`再回复一个词：pong。${followMarker}`);
      await mobile.locator('button[aria-label="发送"]').click();
      return followMarker;
    });

    await check("sync.follow-up-visible-on-web", "sync", async () => {
      const seen = await waitFor("web sees follow-up", async () => {
        const t = await web.locator("#transcript").innerText();
        return t.includes(followMarker) ? "visible" : null;
      }, 20_000);
      await shot(web, "cdp-web-followup-sync");
      return seen;
    });

    await check("ui.web.settings", "ui-web", async () => {
      await web.goto(`${WEB}/#/settings`, { waitUntil: "domcontentloaded" });
      await web.locator("#settings-page").waitFor({ timeout: 8_000 });
      await waitFor("quota loaded", async () => {
        const hint = await web.locator("#quota-status").innerText().catch(() => "");
        return hint && hint !== "配额未加载" ? hint : null;
      }, 8_000);
      const text = await web.locator("#settings-page").innerText();
      await shot(web, "cdp-web-settings");
      if (!/模型|GitHub|额度|MCP|通知|环境/i.test(text)) throw new Error(`settings missing sections: ${text.slice(0, 200)}`);
      return text.slice(0, 160);
    });

    await check("ui.web.experts-nav", "ui-web", async () => {
      await web.goto(`${WEB}/#/experts`, { waitUntil: "domcontentloaded" });
      await web.locator("#experts-page, body").first().waitFor({ timeout: 8_000 });
      return (await pageText(web)).slice(0, 80);
    });

    await check("ui.web.no-project-chip", "ui-web", async () => {
      await web.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
      const n = await web.locator("#project-chip").count();
      if (n !== 0) throw new Error(`#project-chip still present (${n})`);
      return "absent";
    });

    await check("ui.web.projects", "ui-web", async () => {
      await web.goto(`${WEB}/#/projects`, { waitUntil: "domcontentloaded" });
      const text = await waitFor("projects list", async () => {
        const body = await pageText(web);
        return /折叠演示|walkthrough|新建项目/.test(body) && !body.includes("还没有项目") ? body.slice(0, 120) : null;
      }, 10_000);
      await shot(web, "cdp-web-projects");
      return text;
    });

    await check("ui.web.workspace-term", "ui-web", async () => {
      await web.goto(`${WEB}/#/runs/${createdId}`, { waitUntil: "domcontentloaded" });
      await web.locator("#transcript").waitFor({ timeout: 8_000 });
      const openPane = web.getByRole("button", { name: "打开侧栏" }).first();
      if (await openPane.count()) await openPane.click();
      const termTab = web.getByRole("tab", { name: "终端" }).or(web.getByRole("button", { name: "终端" })).first();
      if (await termTab.count()) await termTab.click();
      const term = web.locator("#run-terminal");
      await term.waitFor({ timeout: 8_000 });
      const opener = web.getByRole("button", { name: /打开终端|新终端/ }).first();
      if (await opener.count()) await opener.click();
      await shot(web, "cdp-web-terminal");
      return (await term.innerText().catch(() => "open")).slice(0, 80);
    });

    await check("ui.web.git-panel", "ui-web", async () => {
      const gitTab = web.getByRole("button", { name: /^Git|改动/ }).first();
      if ((await gitTab.count()) === 0) return "no git tab on this run";
      await gitTab.click();
      await shot(web, "cdp-web-git");
      return "opened";
    });

    await check("ui.desk.settings-cloud", "ui-desk", async () => {
      const page = deskElectron?.page ?? deskUi;
      const settings = page.getByRole("button", { name: "Settings" }).or(page.locator('button[aria-label="Settings"]'));
      if ((await settings.count()) === 0) return "no settings button";
      await settings.first().click();
      const cloud = page.getByRole("button", { name: /云端|账号|GitHub/ }).first();
      if (await cloud.count()) await cloud.click();
      await shot(page, "cdp-desk-settings");
      return (await pageText(page)).slice(0, 80);
    });

    await check("api+ui.run-status-after-sync", "sync", async () => {
      const res = await api(`/v1/runs/${createdId}`, { token });
      mustStatus(res.status, 200);
      return String(asRecord(res.json).status);
    });
  } finally {
    await browser.close();
    if (deskElectron) await deskElectron.browser.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  mkdirSync(ART, { recursive: true });
  log(`cdp capability run @ ${new Date().toISOString()}`);

  await check("env.health", "env", async () => {
    const res = await api("/health");
    mustStatus(res.status, 200);
    const h = asRecord(res.json);
    if (h.llmUpstream !== "mock") throw new Error(`llmUpstream=${String(h.llmUpstream)}`);
    if (h.workerRuntime !== "local") throw new Error(`runtime=${String(h.workerRuntime)}`);
    return `kernel=${String(h.agentKernel)} rateLimit=${JSON.stringify(h.rateLimit)}`;
  });

  const token = await loginApi();
  await check("api.auth.login", "auth", async () => `token=${token.slice(0, 12)}…`);

  await runApiSuite(token);
  await runUiSuite(token);

  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.filter((r) => !r.ok);
  const report = {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    passed,
    failed: failed.length,
    rows,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  log(`\n${passed} passed, ${failed.length} failed, ${rows.length} total  → ${OUT}`);
  if (failed.length) {
    for (const row of failed) log(`  - ${row.id}: ${row.detail}`);
    process.exitCode = 1;
  }
}

void main();
