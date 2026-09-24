import { expect, test } from "@playwright/test";
import { createProject, loginAs } from "./helpers.js";

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

  test("repo.global-none: home defaults to 无仓库 and bind requires a URL", async ({ page }) => {
    await loginAs(page);
    await expect(page.locator("#repo-mode")).toHaveText("无仓库");
    await expect(page.locator("#repo-bind")).toHaveCount(0);
    await page.locator("#repo-mode").click();
    await page.getByRole("option", { name: "绑定 Git" }).click();
    await expect(page.locator("#repo-bind")).toBeVisible();
    await page.locator("#prompt").fill("need a repo first");
    await expect(page.locator("#send")).toBeDisabled();
    await page.locator("#repo-bind-url").fill("acme/app");
    await expect(page.locator("#send")).toBeEnabled();
  });

  test("repo.project-cloud: project chat locks 云端 and prefills the default repo", async ({ page }) => {
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
    await expect(page.locator("#repo-mode")).toHaveText("绑定 Git");
    await expect(page.locator("#repo-bind")).toContainText("acme/app");
  });

  test("repo.plus: Plus 仓库 opens the same bind control", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page);
    await page.locator(".buddy-plus").click();
    await page.getByRole("button", { name: "仓库" }).click();
    await expect(page.locator("#repo-mode")).toHaveText("绑定 Git");
    await expect(page.locator("#repo-bind")).toBeVisible();
  });

  test("repo.project-none: starting a project chat without a default stays 无仓库", async ({ page }) => {
    await loginAs(page);
    const project = await createProject(page, { name: "办公组" });
    await page.goto(`/#/projects/${project.id}`);
    await page.getByRole("button", { name: "在项目里开对话" }).click();
    await expect(page.locator("#repo-mode")).toHaveText("无仓库");
    await expect(page.locator("#repo-bind")).toHaveCount(0);
    await expect(page.locator("#execution-target")).toBeDisabled();
  });
});
