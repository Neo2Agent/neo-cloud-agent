import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers.js";

test.describe("voice boundaries", () => {
  test("speech.not-configured: mic click surfaces the missing-key copy", async ({ page }) => {
    await loginAs(page);
    const mic = page.locator("#composer button[aria-label='点一下开始说话'], #composer button.composer-mic");
    await expect(mic).toBeVisible();
    await mic.click();
    await expect(page.locator("#vm-status, .voice-error, .hint").first()).toContainText(/听写未配置|听写服务不可用/, {
      timeout: 10_000,
    });
  });

  test("speech.unauth-status: speech status without a session is not called until login", async ({ page }) => {
    const hits: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/v1/speech/iat")) hits.push(request.method());
    });
    await page.goto("/");
    await expect(page.locator("#auth-gate")).toBeVisible();
    expect(hits).toEqual([]);
  });
});
