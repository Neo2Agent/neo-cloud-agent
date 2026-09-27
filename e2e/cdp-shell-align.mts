/**
 * Compare Web desktop, Web phone shell, and Desk-as-Web home blocks.
 * Requires :8080 and :5173. Starts :5175 phone shell if needed.
 */
import { chromium } from "../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";

const shots: Record<string, unknown> = {};

async function login(page: import("playwright").Page) {
  const gate = page.locator("#auth-form");
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

async function capture(page: import("playwright").Page, name: string, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(600);
  await login(page);
  await page.waitForTimeout(800);
  const path = `/opt/cursor/artifacts/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  const info = await page.evaluate(`(() => {
    const app = document.querySelector(".app");
    return {
      title: document.title,
      shell: document.documentElement.dataset.neoShell || "",
      buddy: Boolean(app && app.classList.contains("is-buddy")),
      recipe: Boolean(document.querySelector(".recipe-grid")),
      empty: Boolean(document.querySelector(".empty h2")),
      emptyText: document.querySelector(".empty h2")?.textContent || "",
      buddyHome: Boolean(document.querySelector(".buddy-home")),
      sidebar: Boolean(document.querySelector(".sidebar")),
      newChat: Boolean(document.querySelector("#new-chat")),
      composer: Boolean(document.querySelector("form.composer, .composer-box")),
      islandHome: Boolean(document.querySelector(".home-hero")),
      rail: Boolean(document.querySelector("aside.rail")),
    };
  })()`);
  shots[name] = { url, ...info, shot: path };
}

const browser = await chromium.launch({
  executablePath: "/usr/local/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await capture(desktop, "shell-web-desktop", "http://127.0.0.1:5173/");

const deskSame = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await capture(deskSame, "shell-desk-as-web", "http://127.0.0.1:5173/");

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await capture(phone, "shell-mobile-phone", "http://127.0.0.1:5175/");

writeFileSync("/opt/cursor/artifacts/shell-align.json", JSON.stringify(shots, null, 2));
await browser.close();

const web = shots["shell-web-desktop"] as Record<string, unknown>;
const desk = shots["shell-desk-as-web"] as Record<string, unknown>;
const mobile = shots["shell-mobile-phone"] as Record<string, unknown>;
const errors: string[] = [];
if (!web.recipe || !web.empty || web.rail) errors.push("web desktop missing recipe empty or still has desk rail");
if (web.buddy) errors.push("web desktop should not be is-buddy at 1280");
if (desk.recipe !== web.recipe || desk.emptyText !== web.emptyText) errors.push("desk-as-web home != web desktop");
if (mobile.islandHome) errors.push("mobile still shows leftover IslandHome");
if (!mobile.buddy && !mobile.buddyHome && !mobile.recipe) errors.push("mobile phone shell has neither BuddyHome nor recipe grid");
if (errors.length) {
  console.error(JSON.stringify({ errors, shots }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, shots }, null, 2));
