import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers.js";

test.describe("catalog and session chrome", () => {
  test("catalog.experts: #/experts shows the experts page after login", async ({ page }) => {
    await loginAs(page);
    await page.goto("/#/experts");
    await expect(page.locator("#experts-page")).toBeVisible();
    await expect(page.locator("#run-title")).toContainText("换角色干活");
  });

  test("catalog.skills: #/skills shows the skills page", async ({ page }) => {
    await loginAs(page);
    await page.goto("/#/skills");
    await expect(page.locator("#skills-page")).toBeVisible();
    await expect(page.locator("#run-title")).toContainText("给 Agent 装工作手册");
  });

  test("catalog.memories-unwired: memories page is reachable and says the store is off", async ({ page }) => {
    await loginAs(page);
    await page.goto("/#/memories");
    await expect(page.locator("#memories-page")).toBeVisible();
    await expect(page.locator("#memories-page")).toContainText(/记忆还没接上|跨对话记住的事/);
  });

  test("settings.hash: #/settings opens the settings page", async ({ page }) => {
    await loginAs(page);
    await page.goto("/#/settings");
    await expect(page.locator("#settings-page")).toBeVisible();
    await expect(page.locator("#repo")).toBeVisible();
  });

  test("catalog.unauth-hash: hash routes still require the login gate", async ({ page }) => {
    await page.goto("/#/experts");
    await expect(page.locator("#auth-gate")).toBeVisible();
    await expect(page.locator("#experts-page")).toHaveCount(0);
  });

  test("workspace.no-run: session tabs stay hidden until a run exists", async ({ page }) => {
    await loginAs(page);
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "会话标签" })).toHaveCount(0);
    await expect(page.locator("#run-terminal")).toHaveCount(0);
    await expect(page.locator("#file-tree")).toHaveCount(0);
  });

  test("nav.app-tabs: top tabs switch without losing the session", async ({ page }) => {
    await loginAs(page);
    await page.locator("#app-tabs button", { hasText: "专家" }).click();
    await expect(page.locator("#experts-page")).toBeVisible();
    await page.locator("#app-tabs button", { hasText: "对话" }).click();
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.locator("#account-email")).toContainText("admin");
  });
});
