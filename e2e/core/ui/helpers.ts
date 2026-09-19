import { expect, type Page } from "@playwright/test";

export const ADMIN_EMAIL = process.env.E2E_EMAIL ?? "admin";
export const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? "123456";

export async function expectLoginGate(page: Page): Promise<void> {
  await expect(page.locator("#auth-gate")).toBeVisible();
  await expect(page.locator("#auth-email")).toBeVisible();
  await expect(page.locator("#auth-submit")).toBeDisabled();
}

export async function loginAs(
  page: Page,
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#auth-gate")).toBeVisible();
  const registerTab = page.locator("#auth-tabs button[data-mode='login']");
  if (await registerTab.count()) {
    await registerTab.click();
  }
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill(password);
  await expect(page.locator("#auth-submit")).toBeEnabled();
  await page.locator("#auth-submit").click();
  await expect(page.locator("#auth-gate")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("#composer")).toBeVisible();
}
