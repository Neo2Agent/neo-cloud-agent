import { appendFile, access, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

async function workspaceRoots(runId: string): Promise<string[]> {
  const roots = [path.join(process.cwd(), ".neo/runs", runId)];
  try {
    for (const name of await readdir(tmpdir())) {
      if (name.startsWith("neo-core-e2e-ui-")) roots.push(path.join(tmpdir(), name, runId));
    }
  } catch {
    /* ignore */
  }
  return roots;
}

async function seedWorkspaceDiff(runId: string): Promise<void> {
  let hello = "";
  for (let i = 0; i < 40; i += 1) {
    for (const root of await workspaceRoots(runId)) {
      const candidate = path.join(root, "hello.txt");
      try {
        await access(candidate);
        hello = candidate;
        break;
      } catch {
        /* keep looking */
      }
    }
    if (hello) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!hello) throw new Error(`workspace for ${runId} never appeared`);
  await appendFile(hello, "changed by e2e\n");
  await writeFile(path.join(path.dirname(hello), "notes.md"), "untracked note\n");
}

async function openGitPanel(page: Page, runId: string): Promise<void> {
  await page.goto(`/#/runs/${runId}`);
  await page.getByRole("button", { name: "打开侧栏" }).first().click();
  const tabs = page.getByRole("tablist", { name: "对话侧栏" }).getByRole("tab");
  await expect(tabs.first()).toHaveText("Git");
  await tabs.first().click();
}

type MockCheck = { name: string; status: string; conclusion: string | null; url: string };

type MockPr = {
  repoUrl: string;
  branch: string;
  baseBranch: string;
  url: string;
  draft: boolean;
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  checks: { passed: number; failed: number; pending: number };
  feedbackChecks?: MockCheck[];
};

const PASSING_CHECKS: MockCheck[] = [
  { name: "typecheck", status: "completed", conclusion: "success", url: "https://github.com/acme/app/actions/1" },
  { name: "test", status: "completed", conclusion: "success", url: "https://github.com/acme/app/actions/2" },
];

async function mockGithubPr(page: Page, initial: MockPr): Promise<void> {
  let pr = { ...initial };
  const feedbackChecks = initial.feedbackChecks ?? PASSING_CHECKS;
  await page.route(/\/v1\/runs\/[^/]+\/diff$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...body, pullRequests: [pr] } });
  });
  await page.route(/\/v1\/runs\/[^/]+\/pull-requests(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({ json: { pullRequests: [pr] } });
  });
  await page.route(/\/v1\/runs\/[^/]+\/pull-requests\/\d+\/feedback$/, async (route) => {
    await route.fulfill({
      json: {
        number: pr.number,
        reviews: [],
        comments: [],
        checks: feedbackChecks,
      },
    });
  });
  await page.route(/\/v1\/runs\/[^/]+\/pull-requests\/\d+\/ready$/, async (route) => {
    pr = { ...pr, draft: false };
    await route.fulfill({ json: { pullRequest: pr } });
  });
  await page.route(/\/v1\/runs\/[^/]+\/pull-requests\/\d+\/merge$/, async (route) => {
    pr = { ...pr, draft: false, state: "merged" };
    await route.fulfill({ json: { pullRequest: pr } });
  });
}

test.describe("git panel", () => {
  test("git.plain-chat: no Git tab and no draft PR button", async ({ page }) => {
    await loginAs(page);
    const runId = await createRun(page, { prompt: "普通聊天，没有仓库" });
    await page.goto(`/#/runs/${runId}`);
    await page.getByRole("button", { name: "打开侧栏" }).first().click();
    const tabs = page.getByRole("tablist", { name: "对话侧栏" }).getByRole("tab");
    await expect(tabs).toHaveText(["终端", "文件"]);
    await expect(page.locator("#open-pr")).toHaveCount(0);
  });

  test("git.repo-run: no open-draft CTA, dirty commit box, CI-only review", async ({ page }) => {
    await loginAs(page);
    const runId = await createRun(page, { prompt: "改 toy-repo", repoUrls: ["fixtures/toy-repo"] });
    await seedWorkspaceDiff(runId);
    await openGitPanel(page, runId);
    await expect(page.locator(".git-pr-name")).toContainText("还没有 PR");
    await expect(page.locator(".git-head-cta")).toHaveCount(0);
    await expect(page.locator("#open-pr")).toHaveCount(0);
    await expect(page.locator(".git-view-pr")).toHaveCount(0);
    await expect(page.locator(".git-commit textarea")).toBeVisible();
    await expect(page.getByRole("button", { name: "提交" })).toBeVisible();
    const files = page.locator(".git-file");
    await expect(files.first()).toBeVisible();
    await files.filter({ hasText: "notes.md" }).click();
    await expect(page.locator(".git-hunk-line.is-add .git-gutter-new")).toContainText("1");
    await files.filter({ hasText: "hello.txt" }).click();
    await expect(page.locator(".git-file.is-on")).toContainText("hello.txt");
    const views = page.getByRole("tablist", { name: "Git" }).getByRole("tab");
    await expect(views).toHaveText(["改动", "审查", /^提交/]);
    await views.nth(1).click();
    await expect(page.locator(".git-draft-card")).toHaveCount(0);
    await expect(page.locator(".git-find-issues")).toHaveCount(0);
    await expect(page.locator(".git-review")).toContainText("还没有检查");
    await views.nth(2).click();
    await expect(page.locator(".git-body")).toBeVisible();
  });

  test("git.header-pr: view PR, CI checks, ready then squash", async ({ page }) => {
    await loginAs(page);
    const runId = await createRun(page, { prompt: "审 mock PR", repoUrls: ["fixtures/toy-repo"] });
    await mockGithubPr(page, {
      repoUrl: "https://github.com/acme/app",
      branch: "neo/feature",
      baseBranch: "main",
      url: "https://github.com/acme/app/pull/12",
      draft: true,
      number: 12,
      title: "Align Git header",
      state: "open",
      checks: { passed: 2, failed: 0, pending: 0 },
    });
    await openGitPanel(page, runId);
    await expect(page.getByRole("link", { name: "查看 PR" })).toHaveAttribute(
      "href",
      "https://github.com/acme/app/pull/12",
    );
    await expect(page.locator(".git-badge")).toHaveText("草稿");
    await expect(page.locator(".git-branch")).toHaveAttribute(
      "href",
      "https://github.com/acme/app/compare/main...neo%2Ffeature",
    );
    await expect(page.locator(".git-head-cta")).toHaveText("标为可合并");
    await expect(page.locator(".git-commit")).toHaveCount(0);
    const views = page.getByRole("tablist", { name: "Git" }).getByRole("tab");
    await views.nth(1).click();
    await expect(page.locator(".git-checks-card")).toContainText("检查已通过");
    await expect(page.locator(".git-tab-dot.is-pass")).toBeVisible();
    await expect(page.locator(".git-find-issues")).toHaveCount(0);
    await page.locator(".git-checks-card > summary").click();
    await expect(page.locator(".git-check-list")).toContainText("typecheck");
    await expect(page.locator(".git-check-count")).toContainText("2 项通过");
    await expect(page.locator(".git-draft-card")).toHaveCount(0);
    await page.locator(".git-head-cta").click();
    await expect(page.locator(".git-head-cta")).toHaveText("压缩合并");
    await expect(page.locator(".git-badge")).toHaveText("打开");
    await page.locator(".git-head-cta").click();
    await expect(page.locator(".git-head-cta")).toHaveText("已合并");
    await expect(page.locator(".git-head-cta")).toBeDisabled();
  });

  test("git.review-fail: find issues only when a check failed", async ({ page }) => {
    await loginAs(page);
    const runId = await createRun(page, { prompt: "审失败检查", repoUrls: ["fixtures/toy-repo"] });
    let reviewed = false;
    await mockGithubPr(page, {
      repoUrl: "https://github.com/acme/app",
      branch: "neo/feature",
      baseBranch: "main",
      url: "https://github.com/acme/app/pull/12",
      draft: true,
      number: 12,
      title: "Failing checks",
      state: "open",
      checks: { passed: 1, failed: 1, pending: 0 },
      feedbackChecks: [
        { name: "typecheck", status: "completed", conclusion: "success", url: "https://github.com/acme/app/actions/1" },
        { name: "test", status: "completed", conclusion: "failure", url: "https://github.com/acme/app/actions/2" },
      ],
    });
    await page.route(/\/v1\/runs\/[^/]+\/review$/, async (route) => {
      reviewed = true;
      await route.fulfill({ json: { id: "follow-1", status: "queued" } });
    });
    await openGitPanel(page, runId);
    const views = page.getByRole("tablist", { name: "Git" }).getByRole("tab");
    await views.nth(1).click();
    await expect(page.locator(".git-checks-card")).toContainText("1 项失败");
    await expect(page.locator(".git-tab-dot.is-fail")).toBeVisible();
    await expect(page.locator(".git-check-group").filter({ hasText: "1 项失败" })).toContainText("test");
    await expect(page.locator(".git-check-group").filter({ hasText: "1 项通过" })).toContainText("typecheck");
    await expect(page.locator(".git-find-issues")).toContainText("查找问题");
    await page.locator(".git-find-issues .git-btn").click();
    await expect(page.locator(".git-find-issues")).toContainText("再审一次");
    expect(reviewed).toBe(true);
  });
});
