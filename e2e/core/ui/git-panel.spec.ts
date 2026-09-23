import { appendFile, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers.js";

async function createRun(page: Page, body: Record<string, unknown>): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem("neo.apiToken.v2") ?? "");
  const response = await page.request.post("/v1/runs", {
    headers: { authorization: `Bearer ${token}` },
    data: { repoUrls: [], ...body },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function seedWorkspaceDiff(runId: string): Promise<void> {
  const root = path.join(process.cwd(), ".neo/runs", runId);
  const hello = path.join(root, "hello.txt");
  for (let i = 0; i < 40; i += 1) {
    try {
      await access(hello);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await appendFile(hello, "changed by e2e\n");
  await writeFile(path.join(root, "notes.md"), "untracked note\n");
}

test.describe("git panel", () => {
  test("git.plain-chat: no Git tab and no draft PR button", async ({ page }) => {
    await loginAs(page);
    const runId = await createRun(page, { prompt: "普通聊天，没有仓库" });
    await page.goto(`/#/runs/${runId}`);
    await page.getByRole("button", { name: "打开侧栏" }).first().click();
    const tabs = page.getByRole("tablist", { name: "对话侧栏" }).getByRole("tab");
    await expect(tabs).toHaveText(["终端", "文件"]);
    await expect(page.locator("#open-pr")).toBeHidden();
  });

  test("git.repo-run: selected file, line gutters, Find Issues, commit box", async ({ page }) => {
    await loginAs(page);
    const runId = await createRun(page, { prompt: "改 toy-repo", repoUrls: ["fixtures/toy-repo"] });
    await seedWorkspaceDiff(runId);
    await page.goto(`/#/runs/${runId}`);
    await page.getByRole("button", { name: "打开侧栏" }).first().click();
    const tabs = page.getByRole("tablist", { name: "对话侧栏" }).getByRole("tab");
    await expect(tabs.first()).toHaveText("Git");
    await tabs.first().click();
    const views = page.getByRole("tablist", { name: "Git" }).getByRole("tab");
    await expect(views).toHaveText(["Diff", "审查", /^提交/]);
    await expect(page.locator(".git-commit textarea")).toBeVisible();
    await expect(page.getByRole("button", { name: "提交" })).toBeVisible();
    const files = page.locator(".git-file");
    await expect(files.first()).toBeVisible();
    await files.filter({ hasText: "notes.md" }).click();
    await expect(page.locator(".git-hunk-line.is-add .git-gutter-new")).toContainText("1");
    await files.filter({ hasText: "hello.txt" }).click();
    await expect(page.locator(".git-hunk-line .git-gutter").first()).toBeVisible();
    await views.nth(1).click();
    await expect(page.locator(".git-review-agent")).toContainText("Find Issues");
    await views.nth(2).click();
    await expect(page.locator(".git-body")).toBeVisible();
  });
});
