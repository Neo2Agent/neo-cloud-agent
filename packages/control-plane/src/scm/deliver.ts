import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PullRequestRef } from "@neo-cloud-agent/contracts";
import { gitOk, parseGithubRepo, runGit } from "./git.js";
import { scmPushToken } from "./token.js";

export type CommitResult = {
  sha: string;
  branch: string;
  message: string;
  empty: boolean;
};

export type PullRequestResult = {
  pushed: boolean;
  pullRequest: PullRequestRef;
};

export type GithubPullsClient = (
  input: { owner: string; repo: string; title: string; body: string; head: string; base: string; token: string },
) => Promise<{ url: string; number: number }>;

const localPrNumbers = new Map<string, number>();

export async function hasChanges(cwd: string, paths?: string[]): Promise<boolean> {
  const staged = await runGit(cwd, ["diff", "--cached", "--name-only"]);
  const work = await runGit(cwd, paths?.length ? ["status", "--porcelain", "--", ...paths] : ["status", "--porcelain"]);
  return Boolean(staged.stdout || work.stdout);
}

export async function commitWorkspace(
  cwd: string,
  input: { message: string; paths?: string[] },
): Promise<CommitResult> {
  const branch = (await gitOk(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])) || "HEAD";
  if (input.paths?.length) {
    await gitOk(cwd, ["add", "--", ...input.paths]);
  } else {
    await gitOk(cwd, ["add", "-A"]);
  }
  if (!(await hasChanges(cwd))) {
    const sha = await gitOk(cwd, ["rev-parse", "HEAD"]);
    return { sha, branch, message: input.message, empty: true };
  }
  await gitOk(cwd, ["commit", "--no-verify", "-m", input.message]);
  const sha = await gitOk(cwd, ["rev-parse", "HEAD"]);
  return { sha, branch, message: input.message, empty: false };
}

export async function ensureOrigin(cwd: string, remoteUrl?: string): Promise<string | null> {
  if (remoteUrl) {
    const existing = await runGit(cwd, ["remote", "get-url", "origin"]);
    if (existing.code === 0) {
      await gitOk(cwd, ["remote", "set-url", "origin", remoteUrl]);
    } else {
      await gitOk(cwd, ["remote", "add", "origin", remoteUrl]);
    }
    return remoteUrl;
  }
  const origin = await runGit(cwd, ["remote", "get-url", "origin"]);
  return origin.code === 0 ? origin.stdout : null;
}

async function withAskpass<T>(password: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-askpass-"));
  const script = path.join(dir, "askpass");
  writeFileSync(
    script,
    `#!/bin/sh
case "$1" in
  *Username*) printf '%s' "x-access-token" ;;
  *) printf '%s' "$NEO_SCM_PASSWORD" ;;
esac
`,
  );
  chmodSync(script, 0o700);
  try {
    return await fn({
      GIT_ASKPASS: script,
      SSH_ASKPASS: script,
      GIT_TERMINAL_PROMPT: "0",
      NEO_SCM_PASSWORD: password,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function pushWorkspace(cwd: string, branch: string, remoteUrl?: string): Promise<{ pushed: boolean; remote: string | null }> {
  const remote = await ensureOrigin(cwd, remoteUrl);
  if (!remote) {
    return { pushed: false, remote: null };
  }
  const token = scmPushToken();
  const github = parseGithubRepo(remote);
  if (github && token) {
    await withAskpass(token, (env) => gitOk(cwd, ["push", "-u", "origin", `HEAD:${branch}`], env));
    return { pushed: true, remote };
  }
  if (github && !token) {
    return { pushed: false, remote };
  }
  await gitOk(cwd, ["push", "-u", "origin", `HEAD:${branch}`]);
  return { pushed: true, remote };
}

export function localPullRequest(
  input: { repoUrl: string; branch: string; title: string; runId: string },
): PullRequestRef {
  const next = (localPrNumbers.get(input.runId) ?? 0) + 1;
  localPrNumbers.set(input.runId, next);
  return {
    repoUrl: input.repoUrl,
    branch: input.branch,
    url: `local://pr/${input.runId}/${next}`,
    draft: true,
    number: next,
    title: input.title,
  };
}

export const defaultGithubPulls: GithubPullsClient = async (input) => {
  const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      draft: true,
    }),
  });
  const body = (await response.json()) as { html_url?: string; number?: number; message?: string };
  if (!response.ok || !body.html_url) {
    throw new Error(body.message ?? `github pulls failed: ${response.status}`);
  }
  return { url: body.html_url, number: body.number ?? 0 };
};

export async function openDraftPullRequest(
  cwd: string,
  input: {
    runId: string;
    repoUrl: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    remoteUrl?: string;
    githubPulls?: GithubPullsClient;
    push?: boolean;
  },
): Promise<PullRequestResult> {
  const pushed =
    input.push === false
      ? { pushed: false, remote: input.remoteUrl ?? input.repoUrl }
      : await pushWorkspace(cwd, input.branch, input.remoteUrl);
  const remote = pushed.remote ?? input.remoteUrl ?? input.repoUrl;
  const github = parseGithubRepo(remote);
  const token = scmPushToken();
  if (github && token) {
    const opened = await (input.githubPulls ?? defaultGithubPulls)({
      owner: github.owner,
      repo: github.repo,
      title: input.title,
      body: input.body,
      head: input.branch,
      base: input.baseBranch || "main",
      token,
    });
    return {
      pushed: pushed.pushed,
      pullRequest: {
        repoUrl: remote,
        branch: input.branch,
        url: opened.url,
        draft: true,
        number: opened.number,
        title: input.title,
      },
    };
  }
  return {
    pushed: pushed.pushed,
    pullRequest: localPullRequest({
      repoUrl: remote,
      branch: input.branch,
      title: input.title,
      runId: input.runId,
    }),
  };
}

export async function workspaceDiff(cwd: string, baseBranch?: string | null): Promise<{ stat: string; patch: string }> {
  const range = baseBranch ? `${baseBranch}...HEAD` : "HEAD";
  const stat = await runGit(cwd, baseBranch ? ["diff", "--stat", range] : ["diff", "--stat"]);
  const patch = await runGit(cwd, baseBranch ? ["diff", range] : ["diff"]);
  const uncommitted = await runGit(cwd, ["diff", "--stat"]);
  return {
    stat: [stat.stdout, uncommitted.stdout].filter(Boolean).join("\n"),
    patch: patch.stdout,
  };
}

export function resetLocalPullRequests(): void {
  localPrNumbers.clear();
}
