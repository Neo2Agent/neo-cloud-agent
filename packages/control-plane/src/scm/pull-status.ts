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

export type GithubFetch = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

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

async function readGithub(response: Response, url: string): Promise<unknown> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = asString(asRecord(body).message);
    throw new Error(message || `github ${response.status} ${url.replace(API, "")}`);
  }
  return body;
}

async function getJson(fetchImpl: GithubFetch, url: string, token: string): Promise<unknown> {
  return readGithub(await fetchImpl(url, { headers: ghHeaders(token) }), url);
}

async function sendJson(
  fetchImpl: GithubFetch,
  url: string,
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return readGithub(
    await fetchImpl(url, {
      method,
      headers: { ...ghHeaders(token), "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    url,
  );
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
    additions: asNumber(pull.additions) ?? pr.additions ?? null,
    deletions: asNumber(pull.deletions) ?? pr.deletions ?? null,
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

function requireGithubPull(pr: PullRequestRef): { owner: string; repo: string; number: number } {
  const slug = githubPullSlug(pr);
  if (!slug) throw new Error("不是 GitHub 上的 pull request");
  return slug;
}

/** Draft → ready. Idempotent if the PR is already open. */
export async function markPullReady(
  pr: PullRequestRef,
  token: string,
  fetchImpl: GithubFetch = fetch,
): Promise<PullRequestRef> {
  const slug = requireGithubPull(pr);
  if (!pr.draft && pr.state === "open") {
    return fetchPullStatus(pr, token, fetchImpl);
  }
  await sendJson(fetchImpl, `${API}/repos/${slug.owner}/${slug.repo}/pulls/${slug.number}`, token, "PATCH", { draft: false });
  return fetchPullStatus({ ...pr, draft: false }, token, fetchImpl);
}

export type GithubMergeMethod = "squash" | "merge" | "rebase";

const MERGE_METHODS = new Set<GithubMergeMethod>(["squash", "merge", "rebase"]);

export function parseGithubMergeMethod(value: unknown): GithubMergeMethod {
  return typeof value === "string" && MERGE_METHODS.has(value as GithubMergeMethod) ? (value as GithubMergeMethod) : "squash";
}

/** Merge an open, non-draft GitHub PR. Defaults to squash. */
export async function mergePull(
  pr: PullRequestRef,
  token: string,
  fetchImpl: GithubFetch = fetch,
  method: GithubMergeMethod = "squash",
): Promise<PullRequestRef> {
  const slug = requireGithubPull(pr);
  if (pr.state === "merged") {
    return fetchPullStatus(pr, token, fetchImpl);
  }
  if (pr.draft) {
    throw new Error("先 Mark as ready");
  }
  if (pr.state === "closed") {
    throw new Error("这个 PR 已经关闭");
  }
  await sendJson(fetchImpl, `${API}/repos/${slug.owner}/${slug.repo}/pulls/${slug.number}/merge`, token, "PUT", {
    merge_method: parseGithubMergeMethod(method),
  });
  return fetchPullStatus({ ...pr, draft: false, state: "merged" }, token, fetchImpl);
}

/** @deprecated use mergePull */
export async function squashMergePull(
  pr: PullRequestRef,
  token: string,
  fetchImpl: GithubFetch = fetch,
): Promise<PullRequestRef> {
  return mergePull(pr, token, fetchImpl, "squash");
}

const DEFAULT_BASES = new Set(["main", "master", "develop", "trunk"]);

export function isDefaultBaseBranch(branch: string | null | undefined): boolean {
  const name = (branch ?? "").trim().toLowerCase();
  return !name || DEFAULT_BASES.has(name);
}

function pickStackedParent(found: unknown[]): Record<string, unknown> | null {
  const rows = found.map((item) => asRecord(item)).filter((item) => asNumber(item.number));
  return rows.find((item) => item.draft !== true && asString(item.state) === "open") ?? rows[0] ?? null;
}

function pullKey(pr: Pick<PullRequestRef, "number" | "url">): string {
  return pr.number != null ? `n:${pr.number}` : `u:${pr.url}`;
}

/** Walk each PR's base branch and attach the parent GitHub PR. Does not add siblings. */
export async function hydrateStackedPulls(
  prs: PullRequestRef[],
  token: string,
  fetchImpl: GithubFetch = fetch,
  options: { preferBranch?: string | null; maxDepth?: number } = {},
): Promise<PullRequestRef[]> {
  const maxDepth = options.maxDepth ?? 8;
  const byKey = new Map<string, PullRequestRef>();
  for (const pr of prs) byKey.set(pullKey(pr), pr);

  let frontier = prs.filter((item) => githubPullSlug(item));
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const nextFrontier: PullRequestRef[] = [];
    for (const pr of frontier) {
      if (isDefaultBaseBranch(pr.baseBranch) || !pr.baseBranch) continue;
      const slug = githubPullSlug(pr);
      if (!slug) continue;
      try {
        const list = await getJson(
          fetchImpl,
          `${API}/repos/${slug.owner}/${slug.repo}/pulls?head=${encodeURIComponent(`${slug.owner}:${pr.baseBranch}`)}&state=all&per_page=5`,
          token,
        );
        const pick = pickStackedParent(Array.isArray(list) ? list : []);
        if (!pick) continue;
        const number = asNumber(pick.number);
        const url = asString(pick.html_url) || (number ? `https://github.com/${slug.owner}/${slug.repo}/pull/${number}` : "");
        const key = number != null ? `n:${number}` : `u:${url}`;
        if (byKey.has(key)) continue;
        const stub: PullRequestRef = {
          repoUrl: pr.repoUrl || `https://github.com/${slug.owner}/${slug.repo}`,
          branch: asString(asRecord(pick.head).ref) || pr.baseBranch,
          url,
          draft: pick.draft === true,
          number,
          title: asString(pick.title),
        };
        const full = await fetchPullStatus(stub, token, fetchImpl).catch(() => stub);
        byKey.set(pullKey(full), full);
        nextFrontier.push(full);
      } catch {
        // no token scope or no parent PR
      }
    }
    frontier = nextFrontier;
  }

  const ordered: PullRequestRef[] = [];
  const seen = new Set<string>();
  for (const pr of prs) {
    const key = pullKey(pr);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(byKey.get(key) ?? pr);
  }
  for (const pr of byKey.values()) {
    const key = pullKey(pr);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(pr);
  }
  const prefer = options.preferBranch;
  if (!prefer) return ordered;
  return [...ordered.filter((item) => item.branch === prefer), ...ordered.filter((item) => item.branch !== prefer)];
}
