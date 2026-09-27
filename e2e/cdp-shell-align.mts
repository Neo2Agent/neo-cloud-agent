/**
 * Compare Web desktop, Mobile phone shell, and Desk Electron wrapping Web.
 * Requires :8080, :5173, :5175. Desk Electron is optional on :9223.
 */
import { chromium } from "../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";

const shots: Record<string, unknown> = {};

async function login(page: import("playwright").Page) {
  const gate = page.locator("#auth-gate:not([hidden]) #auth-form");
  if ((await gate.count()) === 0) return;
  await page.evaluate(`(() => {
    const fields = document.querySelectorAll("#auth-form input");
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const user = document.querySelector("#auth-email") || fields[0];
    const pass = document.querySelector("#auth-password") || fields[1];
    if (!user || !pass) return;
    set.call(user, "admin");
    user.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(pass, "123456");
    pass.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await page.locator("#auth-submit").click();
  await page.waitForTimeout(1500);
}

function pageInfoScript(): string {
  return `(() => {
    const app = document.querySelector(".app");
    return {
      title: document.title,
      href: location.href,
      shell: document.documentElement.dataset.neoShell || "",
      buddy: Boolean(app && app.classList.contains("is-buddy")),
      recipe: Boolean(document.querySelector(".recipe-grid")),
      empty: Boolean(document.querySelector(".empty h2")),
      emptyText: document.querySelector(".empty h2")?.textContent || "",
      buddyHome: Boolean(document.querySelector(".buddy-home")),
      buddyHello: document.querySelector(".buddy-home h2, .buddy-hello")?.textContent || "",
      buddyToggle: Boolean(document.querySelector(".buddy-toggle")),
      sidebar: Boolean(document.querySelector(".sidebar")),
      newChat: Boolean(document.querySelector("#new-chat")),
      composer: Boolean(document.querySelector("form.composer, .composer-box")),
      islandHome: Boolean(document.querySelector(".home-hero")),
      rail: Boolean(document.querySelector("aside.rail")),
      contextBar: Boolean(document.querySelector(".context-bar, .home-greeting")),
      deskBadge: Boolean(document.querySelector(".desk-badge")),
      authTitle: document.querySelector("#auth-title")?.textContent || "",
      neoDesk: Boolean(window.neoDesk),
      canRunLocal: Boolean(window.neoDesk?.canRunLocal),
      rootChildren: document.getElementById("root")?.childElementCount ?? 0,
    };
  })()`;
}

async function capture(page: import("playwright").Page, name: string, url?: string) {
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(600);
  }
  await login(page);
  await page.waitForTimeout(800);
  const path = `/opt/cursor/artifacts/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  const info = await page.evaluate(pageInfoScript());
  shots[name] = { url: url || page.url(), ...info, shot: path };
}

const browser = await chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await capture(desktop, "shell-web-desktop", "http://127.0.0.1:5173/");

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await capture(phone, "shell-mobile-phone", "http://127.0.0.1:5175/");

await browser.close();

try {
  const electron = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = electron.contexts()[0];
  const page = context?.pages().find((item) => item.url().includes("5173")) ?? context?.pages()[0];
  if (page) {
    page.on("pageerror", (err) => {
      shots.electronPageError = String(err.message);
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await capture(page, "shell-desk-electron");
  } else {
    shots.electron = { skipped: "no page on :9223" };
  }
} catch (error) {
  shots.electron = { skipped: error instanceof Error ? error.message : String(error) };
}

writeFileSync("/opt/cursor/artifacts/shell-align.json", JSON.stringify(shots, null, 2));

const web = shots["shell-web-desktop"] as Record<string, unknown>;
const mobile = shots["shell-mobile-phone"] as Record<string, unknown>;
const desk = shots["shell-desk-electron"] as Record<string, unknown> | undefined;
const errors: string[] = [];
if (!web.recipe || !web.empty || web.rail || web.contextBar) {
  errors.push("web desktop missing recipe empty or still has leftover desk chrome");
}
if (web.buddy) errors.push("web desktop should not be is-buddy at 1280");
if (mobile.islandHome) errors.push("mobile still shows leftover IslandHome");
if (!mobile.buddy && !mobile.buddyHome && !mobile.recipe) {
  errors.push("mobile phone shell has neither BuddyHome nor recipe grid");
}
if (mobile.buddyToggle) errors.push("mobile phone shell still shows leftover Desk 电脑 toggle");
if (desk) {
  if (desk.rail || desk.contextBar) errors.push("desk electron still has leftover personal rail/greeting chrome");
  if (!desk.recipe || desk.emptyText !== web.emptyText) errors.push("desk electron home != web desktop");
  if (!desk.neoDesk || !desk.canRunLocal) errors.push("desk electron missing window.neoDesk local capability");
  if (desk.deskBadge) errors.push("desk electron still shows leftover Desk badge");
  if (!desk.rootChildren) errors.push("desk electron #root is empty");
}
if (errors.length) {
  console.error(JSON.stringify({ errors, shots }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, shots }, null, 2));
process.exit(0);
