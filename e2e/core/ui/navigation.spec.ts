import { expect, test } from "@playwright/test";
import { createProject, createRun, loginAs } from "./helpers.js";

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
    await expect(page.locator("#auth-email")).toBeVisible();
    await expect(page.locator("#auth-submit")).toBeVisible();
  });

  test("workspace.no-run: session tabs stay hidden until a run exists", async ({ page }) => {
    await loginAs(page);
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "会话标签" })).toHaveCount(0);
    await expect(page.locator("#run-terminal")).toHaveCount(0);
    await expect(page.locator("#file-tree")).toHaveCount(0);
  });

  test("nav.rail: sidebar nav switches pages without losing the session", async ({ page }) => {
    await loginAs(page);
    const rail = page.getByRole("navigation", { name: "功能" });
    await rail.getByRole("button", { name: "更多" }).hover();
    await page.getByRole("menuitem", { name: "专家" }).click();
    await expect(page.locator("#experts-page")).toBeVisible();
    await page.locator("#new-chat").click();
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.locator("#account-email")).toContainText("admin");
  });

  test("sidebar.project-folder: project chats fold; global chats stay loose", async ({ page }) => {
    await loginAs(page);
    const project = await createProject(page, { name: "侧栏协作组" });
    const office = await createRun(page, {
      prompt: "组内办公",
      projectId: project.id,
      repoUrls: [],
      skipRepoDefaults: true,
    });
    const code = await createRun(page, {
      prompt: "组内代码",
      projectId: project.id,
      repoUrls: ["fixtures/toy-repo"],
    });
    const loose = await createRun(page, { prompt: "全局闲聊", repoUrls: [] });
    await page.reload();
    await expect(page.locator("#composer")).toBeVisible();
    const folder = page.locator(`#run-folder-${project.id}`);
    await expect(folder).toBeVisible();
    await expect(folder).toContainText("侧栏协作组");
    await expect(folder.locator(`[data-id="${office.id}"] .run-kind`)).toHaveText("办公");
    await expect(folder.locator(`[data-id="${code.id}"] .run-kind`)).toHaveText("代码");
    await expect(folder.locator(`[data-id="${loose.id}"]`)).toHaveCount(0);
    await expect(page.locator(`.run-group[data-loose] [data-id="${loose.id}"]`)).toBeVisible();
    await expect(page.locator(`.run-group[data-loose] [data-id="${office.id}"]`)).toHaveCount(0);
  });
});
