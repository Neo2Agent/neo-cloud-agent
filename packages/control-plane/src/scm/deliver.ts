import {
  collectCommits,
  collectWorkspaceDiff,
  GIT_EMPTY_TREE,
  GIT_LOG_FORMAT,
  gitDiffBase,
  parseGitLog,
  type GitFileChange,
  type GitRunner,
  type PullRequestRef,
  type RunCommitRef,
} from "@neo-cloud-agent/contracts";
import { withAskpass } from "./askpass.js";
import { gitOk, parseGithubRepo, runGit } from "./git.js";
import { resolveScmPushToken } from "./token.js";

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


export type PushWorkspaceFn = (
  cwd: string,
  branch: string,
  remoteUrl?: string,
) => Promise<{ pushed: boolean; remote: string | null }>;

type DeliverHooks = {
  githubPulls?: GithubPullsClient;
  push?: PushWorkspaceFn;
};

let deliverHooks: DeliverHooks = {};

/** Test-only: stub GitHub pulls / push so handoff does not hit the network. */
export function setDeliverHooksForTest(hooks: DeliverHooks | null): void {
  deliverHooks = hooks ?? {};
}

export async function pushWorkspace(
  cwd: string,
  branch: string,
  remoteUrl?: string,
  userId?: string,
): Promise<{ pushed: boolean; remote: string | null }> {
  if (deliverHooks.push) {
    return deliverHooks.push(cwd, branch, remoteUrl);
  }
  const remote = await ensureOrigin(cwd, remoteUrl);
  if (!remote) {
    return { pushed: false, remote: null };
  }
  const token = await resolveScmPushToken(userId);
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
    userId?: string;
    githubPulls?: GithubPullsClient;
    push?: boolean;
  },
): Promise<PullRequestResult> {
  const pushed =
    input.push === false
      ? { pushed: false, remote: input.remoteUrl ?? input.repoUrl }
      : await pushWorkspace(cwd, input.branch, input.remoteUrl, input.userId);
  const remote = pushed.remote ?? input.remoteUrl ?? input.repoUrl;
  const github = parseGithubRepo(remote);
  const token = await resolveScmPushToken(input.userId);
  if (github && token) {
    const opened = await (input.githubPulls ?? deliverHooks.githubPulls ?? defaultGithubPulls)({
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

function gitIn(cwd: string): GitRunner {
  return (args) => runGit(cwd, args);
}

/**
 * Everything this run changed: from where the branch forked to the working tree, so committed,
 * staged, unstaged, and untracked changes all show.
 */
export async function workspaceDiff(
  cwd: string,
  baseBranch?: string | null,
): Promise<{ stat: string; patch: string; files: GitFileChange[]; truncated: boolean; dirty: boolean }> {
  const git = gitIn(cwd);
  return collectWorkspaceDiff(git, await gitDiffBase(git, baseBranch));
}

/** Commits on this branch since it forked, newest first. */
export async function workspaceCommits(cwd: string, baseBranch?: string | null): Promise<RunCommitRef[]> {
  const git = gitIn(cwd);
  const base = await gitDiffBase(git, baseBranch);
  if (base === GIT_EMPTY_TREE) return [];
  return collectCommits(git, base === "HEAD" ? ["HEAD"] : [`${base}..HEAD`]);
}

export async function commitInfo(cwd: string, sha: string): Promise<RunCommitRef | null> {
  const log = await runGit(cwd, ["log", "-1", `--format=${GIT_LOG_FORMAT}`, "--numstat", sha]);
  return log.code === 0 ? (parseGitLog(log.stdout)[0] ?? null) : null;
}

export function resetLocalPullRequests(): void {
  localPrNumbers.clear();
}
