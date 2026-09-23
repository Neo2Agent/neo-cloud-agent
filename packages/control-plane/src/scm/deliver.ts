import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  capPatch,
  GIT_COMMITS_MAX,
  GIT_EMPTY_TREE,
  GIT_LOG_FORMAT,
  mergeFileChanges,
  parseGitLog,
  parseNameStatus,
  parseNumstat,
  type GitFileChange,
  type PullRequestRef,
  type RunCommitRef,
} from "@neo-cloud-agent/contracts";
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
  const token = await resolveScmPushToken();
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
  const token = await resolveScmPushToken();
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

/** Untracked files get a synthetic patch; past this many only the name is listed. */
const UNTRACKED_PATCH_FILES = 50;
const UNTRACKED_LIST_FILES = 200;

/** Where this branch forked: merge-base with the base branch, else HEAD, else the empty tree. */
async function diffBase(cwd: string, baseBranch?: string | null): Promise<string> {
  const head = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.code !== 0) return GIT_EMPTY_TREE;
  if (baseBranch) {
    const base = await runGit(cwd, ["merge-base", baseBranch, "HEAD"]);
    if (base.code === 0 && base.stdout) return base.stdout;
  }
  return "HEAD";
}

async function untrackedChanges(cwd: string): Promise<{ files: Array<{ path: string; added: number; binary?: boolean }>; patch: string }> {
  const listed = await runGit(cwd, ["ls-files", "--others", "--exclude-standard"]);
  const paths = listed.stdout
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith(".neo/"))
    .slice(0, UNTRACKED_LIST_FILES);
  const files: Array<{ path: string; added: number; binary?: boolean }> = [];
  const patches: string[] = [];
  for (const [index, file] of paths.entries()) {
    if (index >= UNTRACKED_PATCH_FILES) {
      files.push({ path: file, added: 0 });
      continue;
    }
    const stat = parseNumstat((await runGit(cwd, ["diff", "--no-index", "--numstat", "--", "/dev/null", file])).stdout);
    const entry = [...stat.values()][0];
    files.push({ path: file, added: entry?.added ?? 0, ...(entry?.binary ? { binary: true } : {}) });
    const body = await runGit(cwd, ["diff", "--no-index", "--", "/dev/null", file]);
    if (body.stdout) patches.push(body.stdout);
  }
  return { files, patch: patches.join("\n") };
}

/**
 * Everything this run changed: from where the branch forked to the working tree, so committed,
 * staged, unstaged, and untracked changes all show. Stat, patch, and file list share one base.
 */
export async function workspaceDiff(
  cwd: string,
  baseBranch?: string | null,
): Promise<{ stat: string; patch: string; files: GitFileChange[]; truncated: boolean }> {
  const base = await diffBase(cwd, baseBranch);
  const [stat, patch, numstat, names] = await Promise.all([
    runGit(cwd, ["diff", "-M", "--stat", base]),
    runGit(cwd, ["diff", "-M", base]),
    runGit(cwd, ["diff", "-M", "--numstat", base]),
    runGit(cwd, ["diff", "-M", "--name-status", base]),
  ]);
  const untracked = await untrackedChanges(cwd);
  const files = mergeFileChanges(parseNameStatus(names.stdout), parseNumstat(numstat.stdout), untracked.files);
  const capped = capPatch([patch.stdout, untracked.patch].filter(Boolean).join("\n"));
  const untrackedLine = untracked.files.length > 0 ? `${untracked.files.length} untracked file(s)` : "";
  return {
    stat: [stat.stdout, untrackedLine].filter(Boolean).join("\n"),
    patch: capped.patch,
    files,
    truncated: capped.truncated,
  };
}

/** Commits on this branch since it forked, newest first. */
export async function workspaceCommits(cwd: string, baseBranch?: string | null): Promise<RunCommitRef[]> {
  const base = await diffBase(cwd, baseBranch);
  if (base === GIT_EMPTY_TREE) return [];
  const range = base === "HEAD" ? ["HEAD"] : [`${base}..HEAD`];
  const log = await runGit(cwd, [
    "log",
    "--no-merges",
    `-n${GIT_COMMITS_MAX}`,
    `--format=${GIT_LOG_FORMAT}`,
    "--numstat",
    ...range,
  ]);
  return log.code === 0 ? parseGitLog(log.stdout) : [];
}

export async function commitInfo(cwd: string, sha: string): Promise<RunCommitRef | null> {
  const log = await runGit(cwd, ["log", "-1", `--format=${GIT_LOG_FORMAT}`, "--numstat", sha]);
  return log.code === 0 ? (parseGitLog(log.stdout)[0] ?? null) : null;
}

export function resetLocalPullRequests(): void {
  localPrNumbers.clear();
}
