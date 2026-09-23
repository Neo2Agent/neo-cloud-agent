import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers.js";

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`no box for ${selector}`);
  return found;
}

for (const size of [
  { width: 390, height: 844 },
  { width: 860, height: 900 },
]) {
  test(`narrow.${size.width}: closed drawer takes no room; inspector covers the composer`, async ({ page }) => {
    await page.setViewportSize(size);
    await loginAs(page);

    const sidebar = await box(page, ".sidebar");
    expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(0);
    expect((await box(page, "main")).height).toBe(size.height);

    await page.getByRole("button", { name: "打开对话列表" }).first().click();
    await expect(page.locator(".sidebar")).toBeInViewport();
    await page.locator(".sidebar-backdrop").click({ position: { x: size.width - 8, y: size.height / 2 } });
    await expect(page.locator(".app")).toHaveClass(/sidebar-closed/);

    await page.locator("#prompt").fill("窄屏检查器");
    await page.locator("#send").click();
    await page.getByRole("button", { name: "打开侧栏" }).click();
    await expect(page.locator(".inspector")).toBeVisible();
    const composerOnTop = await page.evaluate(() => {
      const field = document.querySelector("#prompt");
      if (!field) return false;
      const rect = field.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return Boolean(hit && field.contains(hit));
    });
    expect(composerOnTop).toBe(false);
    await expect(page.locator("#prompt")).toBeHidden();

    await page.getByRole("button", { name: "收起侧栏" }).click();
    await expect(page.locator(".inspector")).toHaveCount(0);
    await expect(page.locator("#prompt")).toBeVisible();
  });
}
