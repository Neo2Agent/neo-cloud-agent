import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers.js";

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
});
