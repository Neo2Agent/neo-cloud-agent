import type {
  PullRequestCheck,
  PullRequestChecks,
  PullRequestComment,
  PullRequestFeedback,
  PullRequestRef,
  PullRequestReview,
  PullRequestState,
} from "@neo-cloud-agent/contracts";
import { parseGithubRepo } from "./git.js";

export type GithubFetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

const API = "https://api.github.com";
const PASSED = new Set(["success", "neutral", "skipped"]);

function ghHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Owner, repo, and number for a GitHub PR ref; null for `local://pr` or non-GitHub remotes. */
export function githubPullSlug(pr: Pick<PullRequestRef, "url" | "repoUrl" | "number">): { owner: string; repo: string; number: number } | null {
  const fromUrl = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i.exec(pr.url);
  if (fromUrl) return { owner: fromUrl[1] ?? "", repo: (fromUrl[2] ?? "").replace(/\.git$/i, ""), number: Number(fromUrl[3]) };
  const repo = parseGithubRepo(pr.repoUrl);
  return repo && pr.number ? { ...repo, number: pr.number } : null;
}

export function summarizeChecks(runs: Array<{ status?: string; conclusion?: string | null }>): PullRequestChecks {
  const checks = { passed: 0, failed: 0, pending: 0 };
  for (const run of runs) {
    if (run.status && run.status !== "completed") checks.pending += 1;
    else if (run.conclusion && PASSED.has(run.conclusion)) checks.passed += 1;
    else checks.failed += 1;
  }
  return checks;
}

async function getJson(fetchImpl: GithubFetch, url: string, token: string): Promise<unknown> {
  const response = await fetchImpl(url, { headers: ghHeaders(token) });
  if (!response.ok) {
    throw new Error(`github ${response.status} ${url.replace(API, "")}`);
  }
  return response.json();
}

function checkRuns(body: unknown): PullRequestCheck[] {
  const list = Array.isArray(asRecord(body).check_runs) ? (asRecord(body).check_runs as unknown[]) : [];
  return list.map((item) => {
    const run = asRecord(item);
    return {
      name: asString(run.name),
      status: asString(run.status) || "completed",
      conclusion: asString(run.conclusion) || null,
      url: asString(run.html_url) || asString(run.details_url),
    };
  });
}

/** Current state, base, head, and check counts from GitHub. Leaves the ref untouched on non-GitHub PRs. */
export async function fetchPullStatus(
  pr: PullRequestRef,
  token: string,
  fetchImpl: GithubFetch = fetch,
  now = new Date(),
): Promise<PullRequestRef> {
  const slug = githubPullSlug(pr);
  if (!slug) return pr;
  const base = `${API}/repos/${slug.owner}/${slug.repo}`;
  const pull = asRecord(await getJson(fetchImpl, `${base}/pulls/${slug.number}`, token));
  const merged = pull.merged === true || Boolean(asString(pull.merged_at));
  const state: PullRequestState = merged ? "merged" : asString(pull.state) === "closed" ? "closed" : "open";
  const headSha = asString(asRecord(pull.head).sha) || null;
  let checks = pr.checks ?? null;
  if (headSha) {
    try {
      checks = summarizeChecks(checkRuns(await getJson(fetchImpl, `${base}/commits/${headSha}/check-runs?per_page=100`, token)));
    } catch {
      // checks need an extra permission; keep the last known counts
    }
  }
  return {
    ...pr,
    number: asNumber(pull.number) ?? pr.number,
    title: asString(pull.title) || pr.title,
    url: asString(pull.html_url) || pr.url,
    draft: pull.draft === true,
    state,
    mergedAt: asString(pull.merged_at) || null,
    baseBranch: asString(asRecord(pull.base).ref) || pr.baseBranch || null,
    headSha,
    checks,
    updatedAt: now.toISOString(),
  };
}

/** Reviews, review comments, conversation comments, and checks for one PR. */
export async function fetchPullFeedback(
  pr: PullRequestRef,
  token: string,
  fetchImpl: GithubFetch = fetch,
): Promise<PullRequestFeedback> {
  const slug = githubPullSlug(pr);
  if (!slug) return { number: pr.number ?? 0, reviews: [], comments: [], checks: [] };
  const base = `${API}/repos/${slug.owner}/${slug.repo}`;
  const [reviewsBody, inlineBody, issueBody] = await Promise.all([
    getJson(fetchImpl, `${base}/pulls/${slug.number}/reviews?per_page=100`, token),
    getJson(fetchImpl, `${base}/pulls/${slug.number}/comments?per_page=100`, token),
    getJson(fetchImpl, `${base}/issues/${slug.number}/comments?per_page=100`, token),
  ]);
  const reviews: PullRequestReview[] = (Array.isArray(reviewsBody) ? reviewsBody : [])
    .map((item) => asRecord(item))
    .filter((item) => asString(item.body).trim() || asString(item.state) !== "COMMENTED")
    .map((item) => ({
      id: asNumber(item.id) ?? 0,
      author: asString(asRecord(item.user).login),
      state: asString(item.state),
      body: asString(item.body),
      url: asString(item.html_url),
      submittedAt: asString(item.submitted_at) || null,
    }));
  const comment = (item: Record<string, unknown>, inline: boolean): PullRequestComment => ({
    id: asNumber(item.id) ?? 0,
    author: asString(asRecord(item.user).login),
    body: asString(item.body),
    path: inline ? asString(item.path) || null : null,
    line: inline ? (asNumber(item.line) ?? asNumber(item.original_line)) : null,
    url: asString(item.html_url),
    createdAt: asString(item.created_at) || null,
  });
  const comments = [
    ...(Array.isArray(inlineBody) ? inlineBody : []).map((item) => comment(asRecord(item), true)),
    ...(Array.isArray(issueBody) ? issueBody : []).map((item) => comment(asRecord(item), false)),
  ].sort((left, right) => Date.parse(left.createdAt ?? "") - Date.parse(right.createdAt ?? ""));
  let checks: PullRequestCheck[] = [];
  if (pr.headSha) {
    try {
      checks = checkRuns(await getJson(fetchImpl, `${base}/commits/${pr.headSha}/check-runs?per_page=100`, token));
    } catch {
      checks = [];
    }
  }
  return { number: slug.number, reviews, comments, checks };
}
