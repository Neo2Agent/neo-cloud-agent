import { expect, test } from "@playwright/test";
import { createRun, loginAs } from "./helpers.js";

const CLONE_TITLE = "仓库克隆超时：app，已等待 180 秒。";
const CLONE_STDERR = "git clone timed out after 180000ms\nfatal: unable to access";

function cloneFailSnapshot(
  runId: string,
  extra: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  const messages = [
    {
      id: "u1",
      role: "user",
      text: "clone fail fixture",
      createdAt: "2026-09-25T00:00:00.000Z",
    },
    {
      id: "c1",
      role: "setup",
      text: CLONE_TITLE,
      detail: CLONE_STDERR,
      createdAt: "2026-09-25T00:00:01.000Z",
      kind: "scm.clone_failed",
      level: "error",
    },
    ...extra,
  ];
  return {
    snapshot: {
      runId,
      seq: messages.length,
      lastEventId: messages.at(-1)?.id ?? "c1",
      remaining: 0,
      nextBefore: null,
      total: messages.length,
      messages,
    },
  };
}

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
        body: JSON.stringify(cloneFailSnapshot(runId)),
      });
    });
    const run = await createRun(page, { prompt: "clone fail fixture" });
    await page.goto(`/#/runs/${run.id}`);
    const banner = page.locator(".setup-fail");
    await expect(banner).toContainText(CLONE_TITLE);
    await expect(page.locator(".setup-fail.is-sticky")).toHaveCount(0);
    await expect(page.locator(".setup-fail-log")).toHaveCount(0);
    await page.screenshot({ path: "/opt/cursor/artifacts/setup-fail-collapsed.png", fullPage: true });
    await banner.getByRole("button", { name: "查看诊断" }).click();
    await expect(page.locator(".setup-fail-log")).toContainText("fatal: unable to access");
    await expect(page.locator("#run-terminal")).toHaveCount(0);
    await expect(banner.getByRole("button", { name: "收起诊断" })).toBeVisible();
    await page.screenshot({ path: "/opt/cursor/artifacts/setup-fail-inline.png", fullPage: true });
  });

  test("setup.clone-fail-stays-under-turn: later bubbles do not pull the fail bar to the composer", async ({
    page,
  }) => {
    await loginAs(page);
    await page.route("**/v1/runs/**/transcript**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const runId = pathname.split("/")[3] ?? "run";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          cloneFailSnapshot(runId, [
            {
              id: "u2",
              role: "user",
              text: "现在看的 git 仓库名字",
              createdAt: "2026-09-26T00:00:00.000Z",
            },
            {
              id: "a2",
              role: "assistant",
              text: "neo-cloud-agent",
              createdAt: "2026-09-26T00:00:01.000Z",
            },
          ]),
        ),
      });
    });
    const run = await createRun(page, { prompt: "clone fail then follow up" });
    await page.goto(`/#/runs/${run.id}`);
    const firstUser = page.locator(".bubble.user").first();
    const secondUser = page.locator(".bubble.user").nth(1);
    const banner = page.locator(".setup-fail");
    await expect(firstUser).toContainText("clone fail fixture");
    await expect(secondUser).toContainText("现在看的 git 仓库名字");
    await expect(banner).toContainText(CLONE_TITLE);
    await expect(page.locator(".setup-fail.is-sticky")).toHaveCount(0);
    const firstBox = await firstUser.boundingBox();
    const failBox = await banner.boundingBox();
    const secondBox = await secondUser.boundingBox();
    const composerBox = await page.locator("#composer").boundingBox();
    expect(firstBox && failBox && secondBox && composerBox).toBeTruthy();
    expect(failBox!.y).toBeGreaterThan(firstBox!.y);
    expect(failBox!.y).toBeLessThan(secondBox!.y);
    expect(failBox!.y).toBeLessThan(composerBox!.y);
    await expect(page.locator(".transcript-col > *").last()).not.toHaveClass(/setup-fail/);
    await page.screenshot({ path: "/opt/cursor/artifacts/setup-fail-under-turn.png", fullPage: true });
  });
});
