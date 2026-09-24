import { expect, test } from "@playwright/test";
import { createProject, createRun, loginAs } from "./helpers.js";

test.describe("composer / run boundaries", () => {
  test("runs.empty-ui: send is disabled on a blank composer", async ({ page }) => {
    await loginAs(page);
    await expect(page.locator("#prompt")).toBeVisible();
    await expect(page.locator("#send")).toBeDisabled();
  });

  test("runs.whitespace-only: send stays disabled", async ({ page }) => {
    await loginAs(page);
    await page.locator("#prompt").fill("   ");
    await expect(page.locator("#send")).toBeDisabled();
  });

  test("runs.create-unauth-network: failing POST /v1/runs shows an error row", async ({ page }) => {
    await loginAs(page);
    await page.route("**/v1/runs", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "unauthorized" }),
        });
        return;
      }
      await route.continue();
    });
    await page.locator("#prompt").fill("this should fail auth");
    await expect(page.locator("#send")).toBeEnabled();
    await page.locator("#send").click();
    await expect(page.locator("#transcript")).toContainText("unauthorized");
    await expect(page.locator("#prompt")).toHaveValue("this should fail auth");
  });

  test("runs.network-failure: offline create restores the prompt", async ({ page }) => {
    await loginAs(page);
    await page.route("**/v1/runs", async (route) => {
      if (route.request().method() === "POST") {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.locator("#prompt").fill("offline send");
    await page.locator("#send").click();
    await expect(page.locator("#transcript")).toContainText(/发送失败|Failed|Network|fetch/i);
    await expect(page.locator("#prompt")).toHaveValue("offline send");
  });

  test("runs.hash-unknown: opening a missing run does not crash the shell", async ({ page }) => {
    await loginAs(page);
    await page.goto("/#/runs/run_does_not_exist");
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });

  test("repo.global-none: home defaults to 无仓库", async ({ page }) => {
    await loginAs(page);
    await expect(page.locator("#repo-bind")).toHaveText("无仓库");
  });

  test("repo.search-pick: picker lists account repos and selecting one shows owner/repo", async ({ page }) => {
    await loginAs(page);
    await page.route("**/v1/scm/repos**", async (route) => {
      const url = new URL(route.request().url());
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const all = [
        { fullName: "acme/app", url: "https://github.com/acme/app.git" },
        { fullName: "ada/notes", url: "https://github.com/ada/notes.git" },
        { fullName: "kaibairen/animate-camera", url: "https://github.com/kaibairen/animate-camera.git" },
        {
          fullName: "kaibairen/very-long-repository-name-for-layoutout",
          url: "https://github.com/kaibairen/very-long-repository-name-for-layoutout.git",
        },
      ];
      const repos = q ? all.filter((item) => item.fullName.toLowerCase().includes(q)) : all;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configured: true,
          connected: true,
          login: "ada",
          oauthConfigured: true,
          repos,
        }),
      });
    });
    await page.locator("#repo-bind").click();
    await expect(page.locator("#repo-bind-search")).toBeVisible();
    const menu = page.locator(".repo-bind-menu");
    const box = page.locator(".composer-box");
    const trigger = page.locator("#repo-bind");
    await expect(menu).toBeVisible();
    await expect(box).toBeVisible();
    const openBox = await box.boundingBox();
    const openMenu = await menu.boundingBox();
    const openTrigger = await trigger.boundingBox();
    expect(openBox).toBeTruthy();
    expect(openMenu).toBeTruthy();
    expect(openTrigger).toBeTruthy();
    expect(openMenu?.width ?? 999).toBeLessThanOrEqual(320);
    expect(openMenu?.width ?? 0).toBeLessThan((openBox?.width ?? 0) - 80);
    expect(openMenu?.x ?? 0).toBeGreaterThanOrEqual((openBox?.x ?? 0) - 2);
    expect((openMenu?.x ?? 0) + (openMenu?.width ?? 0)).toBeLessThanOrEqual((openBox?.x ?? 0) + (openBox?.width ?? 0) + 2);
    expect(Math.abs((openMenu?.x ?? 0) - (openTrigger?.x ?? 0))).toBeLessThan(12);
    await page.locator("#repo-bind-search").fill("animate");
    const longRepo = page.getByRole("button", { name: "kaibairen/animate-camera" });
    await expect(longRepo).toBeVisible();
    await expect(page.getByRole("button", { name: "kaibairen/very-long-repository-name-for-layoutout" })).toHaveCount(0);
    await expect(longRepo.locator(".repo-bind-item-name")).toHaveText("animate-camera");
    await expect(longRepo.locator(".repo-bind-item-owner")).toHaveText("kaibairen");
    const filtered = await menu.boundingBox();
    expect(filtered?.height ?? 999).toBeLessThan(180);
    await page.locator("#repo-bind-search").fill("acme");
    await page.getByRole("button", { name: "acme/app" }).click();
    await expect(page.locator("#repo-bind")).toHaveText("acme/app");
    await page.locator("#prompt").fill("use the selected repo");
    await expect(page.locator("#send")).toBeEnabled();
  });

  test("repo.project-cloud: project chat locks 云端 and stays 无仓库", async ({ page }) => {
    await loginAs(page);
    const project = await createProject(page, {
      name: "有默认仓",
      defaultRepoUrls: ["https://github.com/acme/app.git"],
    });
    await page.goto(`/#/projects/${project.id}`);
    await expect(page.locator("#projects-page")).toBeVisible();
    await page.getByRole("button", { name: "在项目里开对话" }).click();
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.locator("#execution-target")).toHaveText("云端");
    await expect(page.locator("#execution-target")).toBeDisabled();
    await expect(page.locator("#repo-bind")).toHaveText("无仓库");
  });

  test("repo.lock-after-send: an existing session cannot change repo", async ({ page }) => {
    await loginAs(page);
    const run = await createRun(page, {
      prompt: "lock the repo",
      repoUrls: ["https://github.com/acme/app.git"],
    });
    await page.goto(`/#/runs/${run.id}`);
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.locator("#repo-bind")).toHaveText("acme/app");
    await page.locator("#repo-bind").click();
    await expect(page.locator("#repo-bind-search")).toHaveCount(0);
  });

  test("repo.plus: Plus 仓库 opens the same picker", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page);
    await page.locator(".buddy-plus").click();
    await page.getByRole("dialog", { name: "添加" }).getByRole("button", { name: "仓库" }).click();
    await expect(page.locator("#repo-bind-search")).toBeVisible();
  });

  test("repo.project-none: starting a project chat stays 无仓库", async ({ page }) => {
    await loginAs(page);
    const project = await createProject(page, { name: "办公组" });
    await page.goto(`/#/projects/${project.id}`);
    await page.getByRole("button", { name: "在项目里开对话" }).click();
    await expect(page.locator("#repo-bind")).toHaveText("无仓库");
    await expect(page.locator("#execution-target")).toBeDisabled();
  });

  test("repo.project-config: project settings no longer has default repos", async ({ page }) => {
    await loginAs(page);
    const project = await createProject(page, { name: "不再默认仓" });
    await page.goto(`/#/projects/${project.id}`);
    await page.getByRole("tab", { name: "配置" }).click();
    await expect(page.getByRole("tab", { name: "指令" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "仓库" })).toHaveCount(0);
    await expect(page.locator("#project-default-repos")).toHaveCount(0);
  });

  test("settings.github: settings shows bind GitHub, not a PAT field", async ({ page }) => {
    await loginAs(page);
    await page.route("**/v1/integrations/github", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ connected: false, login: null, oauthConfigured: true }),
        });
        return;
      }
      await route.continue();
    });
    await page.goto("/#/settings");
    await expect(page.locator("#settings-page")).toBeVisible();
    await expect(page.locator("#github-connect")).toHaveText("绑定 GitHub");
    await expect(page.locator("#scm-token")).toHaveCount(0);
  });
});
