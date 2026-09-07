import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, expectLoginGate, loginAs } from "./helpers.js";

test.describe("auth boundaries", () => {
  test("auth.empty: submit stays disabled until both fields are filled", async ({ page }) => {
    await page.goto("/");
    await expectLoginGate(page);
    await page.locator("#auth-email").fill("admin");
    await expect(page.locator("#auth-submit")).toBeDisabled();
    await page.locator("#auth-password").fill("123456");
    await expect(page.locator("#auth-submit")).toBeEnabled();
  });

  test("auth.wrong-password: shows opaque error and stays on the gate", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#auth-gate")).toBeVisible();
    await page.locator("#auth-email").fill(ADMIN_EMAIL);
    await page.locator("#auth-password").fill("definitely-wrong");
    await page.locator("#auth-submit").click();
    await expect(page.locator("#auth-error")).toBeVisible();
    await expect(page.locator("#auth-error")).toContainText(/invalid account or password|登录失败/);
    await expect(page.locator("#auth-gate")).toBeVisible();
    await expect(page.locator("#auth-submit")).toBeVisible();
    await expect(page.locator("#account-email")).toContainText("未登录");
  });

  test("auth.login-happy then logout returns to the gate", async ({ page }) => {
    await loginAs(page);
    await expect(page.locator("#account-email")).toContainText(ADMIN_EMAIL);
    await page.locator("#logout").click();
    await expect(page.locator("#auth-gate")).toBeVisible();
    await expect(page.locator("#account-email")).toContainText("未登录");
  });

  test("auth.reload: session survives a full page reload", async ({ page }) => {
    await loginAs(page);
    await page.reload();
    await expect(page.locator("#auth-gate")).toBeHidden();
    await expect(page.locator("#composer")).toBeVisible();
    await expect(page.locator("#account-email")).toContainText(ADMIN_EMAIL);
  });

  test("auth.expired: clearing the stored token after reload shows the gate", async ({ page }) => {
    await loginAs(page);
    await page.evaluate(() => localStorage.removeItem("neo.apiToken.v2"));
    await page.reload();
    await expect(page.locator("#auth-gate")).toBeVisible();
  });

  test("auth.register-invalid-phone: API error is shown on the gate", async ({ page }) => {
    await page.goto("/");
    await page.locator("#auth-tabs button[data-mode='register']").click();
    await page.locator("#auth-username").fill("tester");
    await page.locator("#auth-phone").fill("123");
    await page.locator("#auth-password").fill("password1");
    await page.locator("#auth-submit").click();
    await expect(page.locator("#auth-error")).toBeVisible();
    await expect(page.locator("#auth-error")).toContainText("请填写有效的手机号");
    await expect(page.locator("#auth-gate")).toBeVisible();
  });

  test("auth.token-tab-empty: service-token submit stays disabled", async ({ page }) => {
    await page.goto("/");
    await page.locator("#auth-tabs button[data-mode='token']").click();
    await expect(page.locator("#auth-token")).toBeVisible();
    await expect(page.locator("#auth-submit")).toBeDisabled();
  });
});

test.describe("auth narrow viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("auth.narrow-no-token-tab: phone layout hides the service-token tab", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#auth-gate")).toBeVisible();
    await expect(page.locator("#auth-tabs button[data-mode='login']")).toBeVisible();
    await expect(page.locator("#auth-tabs button[data-mode='register']")).toBeVisible();
    await expect(page.locator("#auth-tabs button[data-mode='token']")).toHaveCount(0);
    await expect(page.locator("#auth-copy")).toContainText("先登录，再下任务");
  });
});
