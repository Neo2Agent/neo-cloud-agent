import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PullRequestRef } from "@neo-cloud-agent/contracts";
import { commitInfo, workspaceCommits, workspaceDiff } from "./deliver.js";
import { gitOk } from "./git.js";
import { fetchPullFeedback, fetchPullStatus, githubPullSlug, summarizeChecks, type GithubFetch } from "./pull-status.js";

async function repoWithBranch(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-git-panel-"));
  await gitOk(dir, ["init", "-b", "main"]);
  writeFileSync(path.join(dir, "README.md"), "hello\n");
  writeFileSync(path.join(dir, "keep.ts"), "export const a = 1;\n");
  await gitOk(dir, ["add", "-A"]);
  await gitOk(dir, ["commit", "-m", "base"]);
  await gitOk(dir, ["checkout", "-b", "neo/feature-1234abcd"]);
  writeFileSync(path.join(dir, "README.md"), "hello\nworld\n");
  await gitOk(dir, ["commit", "-am", "feat: say world"]);
  return dir;
}

test("workspaceDiff covers committed, uncommitted, and untracked changes from the merge base", async () => {
  const dir = await repoWithBranch();
  writeFileSync(path.join(dir, "keep.ts"), "export const a = 2;\n");
  writeFileSync(path.join(dir, "notes.md"), "one\ntwo\n");
  const diff = await workspaceDiff(dir, "main");
  assert.deepEqual(
    diff.files.map((item) => `${item.status}:${item.path}:+${item.added}-${item.removed}`),
    ["modified:keep.ts:+1-1", "untracked:notes.md:+2-0", "modified:README.md:+1-0"],
  );
  assert.match(diff.patch, /\+world/);
  assert.match(diff.patch, /\+export const a = 2;/);
  assert.match(diff.patch, /\+\+\+ b\/notes\.md/);
  assert.match(diff.stat, /README\.md/);
  assert.match(diff.stat, /1 untracked file/);
  assert.equal(diff.truncated, false);
});

test("workspaceDiff on a repo with no commits diffs against the empty tree", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-git-empty-"));
  await gitOk(dir, ["init", "-b", "main"]);
  writeFileSync(path.join(dir, "a.txt"), "x\n");
  const diff = await workspaceDiff(dir, null);
  assert.deepEqual(diff.files.map((item) => `${item.status}:${item.path}`), ["untracked:a.txt"]);
  assert.deepEqual(await workspaceCommits(dir, null), []);
});

test("workspaceCommits lists only this branch's commits with numstat; commitInfo reads one", async () => {
  const dir = await repoWithBranch();
  writeFileSync(path.join(dir, "keep.ts"), "export const a = 3;\nexport const b = 4;\n");
  await gitOk(dir, ["commit", "-am", "fix: keep"]);
  const commits = await workspaceCommits(dir, "main");
  assert.deepEqual(commits.map((item) => item.message), ["fix: keep", "feat: say world"]);
  assert.deepEqual({ added: commits[0]?.added, removed: commits[0]?.removed, files: commits[0]?.files }, { added: 2, removed: 1, files: 1 });
  assert.equal(commits[0]?.author, "Neo Cloud Agent");
  const one = await commitInfo(dir, commits[1]?.sha ?? "");
  assert.equal(one?.message, "feat: say world");
});

function fakeGithub(routes: Record<string, unknown>): { fetch: GithubFetch; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (url) => {
      const key = url.replace("https://api.github.com", "").replace(/\?.*$/, "");
      seen.push(key);
      if (!(key in routes)) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

const pr: PullRequestRef = {
  repoUrl: "https://github.com/acme/app",
  branch: "neo/feature-1234abcd",
  url: "https://github.com/acme/app/pull/12",
  draft: true,
  number: 12,
  title: "Draft",
};

test("fetchPullStatus reads state, base, head, and check counts", async () => {
  const github = fakeGithub({
    "/repos/acme/app/pulls/12": {
      number: 12,
      title: "Web polish",
      html_url: "https://github.com/acme/app/pull/12",
      state: "closed",
      merged: true,
      merged_at: "2026-09-23T11:35:05Z",
      draft: false,
      base: { ref: "main" },
      head: { sha: "abc123" },
    },
    "/repos/acme/app/commits/abc123/check-runs": {
      check_runs: [
        { name: "test", status: "completed", conclusion: "success" },
        { name: "loop", status: "completed", conclusion: "failure" },
        { name: "lint", status: "in_progress", conclusion: null },
      ],
    },
  });
  const next = await fetchPullStatus(pr, "tok", github.fetch, new Date("2026-09-23T12:00:00Z"));
  assert.equal(next.state, "merged");
  assert.equal(next.draft, false);
  assert.equal(next.title, "Web polish");
  assert.equal(next.baseBranch, "main");
  assert.deepEqual(next.checks, { passed: 1, failed: 1, pending: 1 });
  assert.equal(next.updatedAt, "2026-09-23T12:00:00.000Z");
  assert.deepEqual(summarizeChecks([{ status: "completed", conclusion: "skipped" }]), { passed: 1, failed: 0, pending: 0 });
  assert.equal(githubPullSlug({ url: "local://pr/run/1", repoUrl: "/tmp/repo", number: 1 }), null);
});

test("fetchPullFeedback merges reviews, inline and conversation comments", async () => {
  const github = fakeGithub({
    "/repos/acme/app/pulls/12/reviews": [
      { id: 1, user: { login: "alice" }, state: "CHANGES_REQUESTED", body: "Handle null", html_url: "u1", submitted_at: "2026-09-23T10:00:00Z" },
      { id: 2, user: { login: "bob" }, state: "COMMENTED", body: "", html_url: "u2" },
    ],
    "/repos/acme/app/pulls/12/comments": [
      { id: 3, user: { login: "alice" }, body: "off by one", path: "src/a.ts", line: 7, html_url: "u3", created_at: "2026-09-23T10:01:00Z" },
    ],
    "/repos/acme/app/issues/12/comments": [
      { id: 4, user: { login: "carol" }, body: "LGTM after fix", html_url: "u4", created_at: "2026-09-23T10:02:00Z" },
    ],
  });
  const feedback = await fetchPullFeedback({ ...pr, headSha: null }, "tok", github.fetch);
  assert.deepEqual(feedback.reviews.map((item) => item.author), ["alice"]);
  assert.deepEqual(
    feedback.comments.map((item) => `${item.author}:${item.path ?? "-"}:${item.line ?? "-"}`),
    ["alice:src/a.ts:7", "carol:-:-"],
  );
  assert.deepEqual(feedback.checks, []);
});
