/**
 * Block-by-block CDP: login, home, composer, settings, mobile drawer.
 * Requires :8080, :5173, :5175, Desk Electron on :9223.
 */
import { chromium, type Page } from "../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";

const shots: Record<string, unknown> = {};

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
  await page.waitForTimeout(1500);
}

async function shot(page: Page, name: string) {
  const path = `/opt/cursor/artifacts/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  const info = await page.evaluate(`(() => ({
    href: location.href,
    title: document.title,
    auth: Boolean(document.querySelector("#auth-gate:not([hidden])")),
    authTitle: document.querySelector("#auth-title")?.textContent || "",
    recipe: Boolean(document.querySelector(".recipe-grid")),
    emptyText: document.querySelector(".empty h2")?.textContent || "",
    buddyHome: Boolean(document.querySelector(".buddy-home")),
    buddyToggle: Boolean(document.querySelector(".buddy-toggle")),
    rail: Boolean(document.querySelector("aside.rail")),
    contextBar: Boolean(document.querySelector(".context-bar, .home-greeting")),
    deskBadge: Boolean(document.querySelector(".desk-badge")),
    targetText: document.querySelector("#execution-target")?.textContent || "",
    targetOptions: [...document.querySelectorAll(".neo-select-item")].map((item) => item.textContent || ""),
    composer: (document.querySelector("form.composer, .composer-box")?.innerText || "").slice(0, 240),
    settings: Boolean(document.querySelector(".settings, #settings, [data-page=settings]")),
    sidebarOpen: Boolean(document.querySelector(".sidebar")),
    neoDesk: Boolean(window.neoDesk),
    canRunLocal: Boolean(window.neoDesk?.canRunLocal),
  }))()`);
  shots[name] = { ...info, shot: path };
}

const chrome = await chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const web = await chrome.newPage({ viewport: { width: 1280, height: 800 } });
await web.goto("http://127.0.0.1:5173/#/settings", { waitUntil: "domcontentloaded" });
await web.waitForTimeout(500);
if (await web.locator("#auth-gate:not([hidden])").count()) {
  await shot(web, "block-web-login");
}
await login(web);
await shot(web, "block-web-settings");
await web.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
await web.waitForTimeout(600);
await login(web);
await shot(web, "block-web-home");
await web.locator("#execution-target").click().catch(() => undefined);
await web.waitForTimeout(300);
await shot(web, "block-web-composer");

const phone = await chrome.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto("http://127.0.0.1:5175/", { waitUntil: "domcontentloaded" });
await phone.waitForTimeout(500);
if (await phone.locator("#auth-gate:not([hidden])").count()) {
  await shot(phone, "block-mobile-login");
}
await login(phone);
await shot(phone, "block-mobile-home");
await phone.locator(".composer-box, form.composer").click().catch(() => undefined);
await phone.waitForTimeout(200);
await shot(phone, "block-mobile-composer");
await phone.locator("#menu-toggle, button[aria-label='打开对话列表'], button[aria-label='打开菜单']").first().click().catch(() => undefined);
await phone.waitForTimeout(400);
await shot(phone, "block-mobile-sidebar");

await chrome.close();

const electron = await chromium.connectOverCDP("http://127.0.0.1:9223");
const context = electron.contexts()[0];
const desk = context?.pages().find((item) => item.url().includes("5173")) ?? context?.pages()[0];
if (!desk) throw new Error("no electron page");
desk.on("pageerror", (err) => {
  shots.electronPageError = String(err.message);
});
await desk.reload({ waitUntil: "domcontentloaded" });
await desk.waitForTimeout(1500);
if (await desk.locator("#auth-gate:not([hidden])").count()) {
  await shot(desk, "block-desk-login");
}
await login(desk);
await desk.evaluate(`location.hash = "#/"`);
await desk.waitForTimeout(400);
await desk.locator("#new-chat").click().catch(() => undefined);
await desk.waitForTimeout(600);
await shot(desk, "block-desk-home");
await desk.locator("#execution-target").click().catch(() => undefined);
await desk.waitForTimeout(300);
await shot(desk, "block-desk-composer");
await desk.evaluate(`location.hash = "#/settings"`);
await desk.waitForTimeout(800);
await shot(desk, "block-desk-settings");

writeFileSync("/opt/cursor/artifacts/shell-blocks.json", JSON.stringify(shots, null, 2));
const errors: string[] = [];
const webHome = shots["block-web-home"] as Record<string, unknown> | undefined;
const deskHome = shots["block-desk-home"] as Record<string, unknown> | undefined;
const mobileHome = shots["block-mobile-home"] as Record<string, unknown> | undefined;
if (!webHome?.recipe || webHome.rail || webHome.contextBar) errors.push("web home leftover desk chrome");
if (!deskHome?.recipe || deskHome.emptyText !== webHome?.emptyText) errors.push("desk home != web home");
if (deskHome?.targetText && String(deskHome.targetText).includes("远程机")) errors.push("desk still on leftover P3 remote");
if (!deskHome?.neoDesk || !deskHome.canRunLocal) errors.push("desk missing neoDesk");
const deskComposer = shots["block-desk-composer"] as Record<string, unknown> | undefined;
const webComposer = shots["block-web-composer"] as Record<string, unknown> | undefined;
const webOptions = Array.isArray(webComposer?.targetOptions) ? (webComposer.targetOptions as string[]) : [];
const deskOptions = Array.isArray(deskComposer?.targetOptions) ? (deskComposer.targetOptions as string[]) : [];
if (webComposer && !String(webComposer.targetText || "").includes("云端")) errors.push("web composer missing 云端");
if (webOptions.some((item) => item.includes("This Computer") || item.includes("Remote Control"))) {
  errors.push("web offered local start");
}
if (deskHome?.canRunLocal && !deskOptions.some((item) => item.includes("This Computer"))) {
  errors.push("desk composer missing This Computer");
}
if (deskHome?.canRunLocal && !deskOptions.some((item) => item.includes("Remote Control"))) {
  errors.push("desk composer missing Remote Control");
}
if (mobileHome?.buddyToggle) errors.push("mobile still has 电脑 toggle");
if (deskHome?.buddyToggle) errors.push("desk still has leftover 电脑 toggle");
if (mobileHome && !mobileHome.buddyHome) errors.push("mobile not BuddyHome");
if (shots.electronPageError) errors.push(`electron pageerror ${shots.electronPageError}`);
if (errors.length) {
  console.error(JSON.stringify({ errors, shots }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, shots }, null, 2));
process.exit(0);
