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

export async function apiToken(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem("neo.apiToken.v2") ?? "");
}

export async function createProject(
  page: Page,
  body: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const token = await apiToken(page);
  const response = await page.request.post("/v1/projects", {
    headers: { authorization: `Bearer ${token}` },
    data: { name: `组 ${Date.now()}`, ...body },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

export async function createRun(
  page: Page,
  body: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const token = await apiToken(page);
  const response = await page.request.post("/v1/runs", {
    headers: { authorization: `Bearer ${token}` },
    data: { prompt: "e2e run", repoUrls: [], ...body },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string };
}
