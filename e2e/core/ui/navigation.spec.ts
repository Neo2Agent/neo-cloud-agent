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
    const stamp = Date.now();
    const officeProject = await createProject(page, { name: `侧栏办公组 ${stamp}` });
    const codeProject = await createProject(page, { name: `侧栏协作组 ${stamp}` });
    const office = await createRun(page, {
      prompt: "组内办公",
      projectId: officeProject.id,
      repoUrls: [],
      skipRepoDefaults: true,
    });
    const code = await createRun(page, {
      prompt: "组内代码",
      projectId: codeProject.id,
      repoUrls: ["fixtures/toy-repo"],
    });
    const loose = await createRun(page, { prompt: "全局闲聊", repoUrls: [] });
    await page.reload();
    await expect(page.locator("#composer")).toBeVisible();
    const officeFolder = page.locator(`#run-folder-${officeProject.id}`);
    const codeFolder = page.locator(`#run-folder-${codeProject.id}`);
    const projectSection = page.locator(`[data-section="projects"]`);
    await expect(officeFolder).toBeVisible();
    await expect(officeFolder).toContainText(officeProject.name);
    await expect(officeFolder.locator(".run-folder-icon")).toHaveCount(1);
    await expect(officeFolder.locator(".run-folder-chevron")).toHaveCount(1);
    await expect(projectSection.locator("> .run-section-head .run-folder-chevron")).toHaveCount(1);
    await expect(officeFolder).toHaveAttribute("data-work", "office");
    await expect(officeFolder.locator(".run-folder-kind")).toHaveCount(0);
    await expect(officeFolder.locator(".run-folder-count")).toHaveCount(0);
    await expect(officeFolder.locator(`[data-id="${office.id}"]`)).toBeVisible();
    await expect(officeFolder.locator(".run-kind")).toHaveCount(0);
    await expect(page.locator('.run-item[data-busy="false"] .pulse-dot')).toHaveCount(0);
    await expect(officeFolder.locator(`[data-id="${office.id}"] .run-mark`)).toBeVisible();
    await expect(codeFolder).toBeVisible();
    await expect(codeFolder).toHaveAttribute("data-work", "code");
    await expect(codeFolder.locator(".run-folder-kind")).toHaveCount(0);
    await expect(codeFolder.locator(`[data-id="${code.id}"]`)).toBeVisible();
    await expect(codeFolder.locator(`[data-id="${loose.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-section="chat"] [data-id="${loose.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-section="chat"] [data-id="${office.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-section="repos"] [data-id="${code.id}"]`)).toHaveCount(0);
    await expect(projectSection).toContainText("项目");
    await expect(page.getByRole("button", { name: "新建协作组" })).toHaveCount(0);
    await expect(officeFolder.getByRole("button", { name: `在「${officeProject.name}」里开对话` })).toHaveCount(1);
    await expect(page.locator(".run-search")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "功能" }).getByRole("button", { name: "搜索" })).toBeVisible();
    await page.getByRole("navigation", { name: "功能" }).getByRole("button", { name: "搜索" }).click();
    await expect(page.getByRole("dialog", { name: "搜索对话" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "搜索对话" })).toHaveCount(0);
    await expect(page.locator(".session-head")).toHaveCount(0);

    await officeFolder.locator(`[data-id="${office.id}"]`).click();
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.locator("#project-chip")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "打开项目" })).toHaveCount(0);

    await officeFolder.locator("> .run-folder-head").hover();
    await officeFolder.getByRole("button", { name: `在「${officeProject.name}」里开对话` }).click();
    await expect(page.locator("#project-chip")).toContainText(`将在项目「${officeProject.name}」中开对话`);
    await expect(page.getByRole("button", { name: "不用项目" })).toBeVisible();

    await officeFolder.locator("> .run-folder-head").click();
    await expect(officeFolder.locator(`[data-id="${office.id}"]`)).toBeHidden();
    await expect(codeFolder.locator(`[data-id="${code.id}"]`)).toBeVisible();

    await projectSection.locator("> .run-section-head").click();
    await expect(officeFolder).toBeHidden();
    await expect(codeFolder).toBeHidden();
  });

  test("sidebar.repo-folder: unbound same-repo chats fold; project chats stay out", async ({ page }) => {
    await loginAs(page);
    const project = await createProject(page, { name: `侧栏仓组 ${Date.now()}` });
    const projectCode = await createRun(page, {
      prompt: "组内同仓",
      projectId: project.id,
      repoUrls: ["fixtures/toy-repo"],
    });
    const first = await createRun(page, {
      prompt: "散装仓一",
      repoUrls: ["fixtures/toy-repo"],
    });
    const second = await createRun(page, {
      prompt: "散装仓二",
      repoUrls: ["fixtures/toy-repo"],
    });
    const everyday = await createRun(page, { prompt: "日常闲聊", repoUrls: [] });
    await page.reload();
    await expect(page.locator("#composer")).toBeVisible();
    const repoFolder = page.locator(`[data-section="repos"] [data-repo="fixtures/toy-repo"]`);
    await expect(repoFolder).toBeVisible();
    await expect(repoFolder).toContainText("fixtures/toy-repo");
    await expect(repoFolder.locator(".run-folder-count")).toHaveCount(0);
    await expect(repoFolder.locator(".run-folder-chevron")).toHaveCount(1);
    await expect(repoFolder.locator(".run-folder-icon")).toHaveCount(1);
    await expect(repoFolder.locator(`[data-id="${first.id}"]`)).toBeVisible();
    await expect(repoFolder.locator(`[data-id="${second.id}"]`)).toBeVisible();
    await expect(repoFolder.locator(`[data-id="${projectCode.id}"]`)).toHaveCount(0);
    await expect(page.locator(`#run-folder-${project.id} [data-id="${projectCode.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-section="chat"] [data-id="${everyday.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-section="chat"] [data-id="${first.id}"]`)).toHaveCount(0);
  });
});
