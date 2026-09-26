import { expect, test } from "@playwright/test";
import { createRun, loginAs } from "./helpers.js";

const CLONE_TITLE = "仓库克隆超时：app，已等待 180 秒。";
const CLONE_STDERR = "git clone timed out after 180000ms\nfatal: unable to access";

test.describe("setup failure banner", () => {
  test("setup.clone-fail-inline: 查看诊断 expands stderr and leaves the terminal closed", async ({
    page,
  }) => {
    await loginAs(page);
    await page.route("**/v1/runs/**/transcript**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const runId = pathname.split("/")[3] ?? "run";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          snapshot: {
            runId,
            seq: 2,
            lastEventId: "c1",
            remaining: 0,
            nextBefore: null,
            total: 2,
            messages: [
            {
              id: "u1",
              role: "user",
              text: "clone fail fixture",
              createdAt: "2026-09-26T00:00:00.000Z",
            },
            {
              id: "c1",
              role: "setup",
              text: CLONE_TITLE,
              detail: CLONE_STDERR,
              createdAt: "2026-09-26T00:00:01.000Z",
              kind: "scm.clone_failed",
              level: "error",
            },
          ],
          },
        }),
      });
    });
    const run = await createRun(page, { prompt: "clone fail fixture" });
    await page.goto(`/#/runs/${run.id}`);
    const banner = page.locator(".setup-fail.is-sticky");
    await expect(banner).toContainText(CLONE_TITLE);
    await expect(page.locator(".setup-fail-log")).toHaveCount(0);
    await page.screenshot({ path: "/opt/cursor/artifacts/setup-fail-collapsed.png", fullPage: true });
    await banner.getByRole("button", { name: "查看诊断" }).click();
    await expect(page.locator(".setup-fail-log")).toContainText("fatal: unable to access");
    await expect(page.locator("#run-terminal")).toHaveCount(0);
    await expect(banner.getByRole("button", { name: "收起诊断" })).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/setup-fail-inline.png", fullPage: true });
  });
});
