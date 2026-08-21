import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseGithubRepo, runGit } from "./git.js";
import { gitConfigHasSecret, prepareWorkspaceRepo, runBranchName } from "./branch.js";
import { commitWorkspace, openDraftPullRequest } from "./deliver.js";

async function initSourceRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-src-"));
  writeFileSync(path.join(dir, "hello.txt"), "hello\n");
  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "--local", "user.email", "test@local"]);
  await runGit(dir, ["config", "--local", "user.name", "test"]);
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-m", "init"]);
  return dir;
}

test("parseGithubRepo accepts shorthand and https urls", () => {
  assert.deepEqual(parseGithubRepo("github.com/acme/app"), { owner: "acme", repo: "app" });
  assert.deepEqual(parseGithubRepo("https://github.com/acme/app.git"), { owner: "acme", repo: "app" });
  assert.equal(parseGithubRepo("/tmp/local.git"), null);
});

test("prepareWorkspaceRepo creates a neo/ branch without storing secrets", async () => {
  const dir = await initSourceRepo();
  const prepared = await prepareWorkspaceRepo(dir, { runId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", prompt: "Add README" });
  assert.equal(prepared.branch, runBranchName("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "Add README"));
  assert.equal(prepared.baseBranch, "main");
  const branch = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  assert.equal(branch.stdout, prepared.branch);
  assert.equal(gitConfigHasSecret(dir, "ghp-secret"), false);
});

test("controlled commit and local draft PR push to a bare remote", async () => {
  const src = await initSourceRepo();
  const prepared = await prepareWorkspaceRepo(src, { runId: "run-pr-1", prompt: "ship it" });
  writeFileSync(path.join(src, "NOTE.md"), "from agent\n");
  const commit = await commitWorkspace(src, { message: "feat: add note" });
  assert.equal(commit.empty, false);
  assert.match(commit.sha, /^[0-9a-f]{40}$/);

  const bare = mkdtempSync(path.join(tmpdir(), "neo-bare-"));
  await runGit(bare, ["init", "--bare"]);
  const result = await openDraftPullRequest(src, {
    runId: "run-pr-1",
    repoUrl: bare,
    branch: prepared.branch,
    baseBranch: prepared.baseBranch,
    title: "ship it",
    body: "agent body",
    remoteUrl: bare,
  });
  assert.equal(result.pushed, true);
  assert.equal(result.pullRequest.draft, true);
  assert.match(result.pullRequest.url, /^local:\/\/pr\/run-pr-1\//);
  const remoteBranches = await runGit(bare, ["branch", "--list"]);
  assert.match(remoteBranches.stdout, /neo\/ship-it-run-pr-1/);
  assert.equal(readFileSync(path.join(src, ".git/config"), "utf8").includes("GITHUB_TOKEN"), false);
});

test("GitHub draft PR uses the injected client and not a token on disk", async () => {
  const src = await initSourceRepo();
  const prepared = await prepareWorkspaceRepo(src, { runId: "run-gh-1", prompt: "open pr" });
  writeFileSync(path.join(src, "change.txt"), "x\n");
  await commitWorkspace(src, { message: "feat: change" });
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "ghp-must-not-hit-disk";
  try {
    const result = await openDraftPullRequest(src, {
      runId: "run-gh-1",
      repoUrl: "https://github.com/acme/app.git",
      branch: prepared.branch,
      baseBranch: "main",
      title: "open pr",
      body: "body",
      remoteUrl: "https://github.com/acme/app.git",
      push: false,
      githubPulls: async (input) => {
        assert.equal(input.owner, "acme");
        assert.equal(input.repo, "app");
        assert.equal(input.token, "ghp-must-not-hit-disk");
        assert.equal(input.head, prepared.branch);
        return { url: "https://github.com/acme/app/pull/9", number: 9 };
      },
    });
    assert.equal(result.pushed, false);
    assert.equal(result.pullRequest.url, "https://github.com/acme/app/pull/9");
    assert.equal(result.pullRequest.number, 9);
    assert.equal(gitConfigHasSecret(src, "ghp-must-not-hit-disk"), false);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
});

test("default gitignore is written only when missing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-empty-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "a.txt"), "a\n");
  await prepareWorkspaceRepo(dir, { runId: "run-ignore", prompt: "init" });
  assert.match(readFileSync(path.join(dir, ".gitignore"), "utf8"), /\.env/);
});
