export const SUBSCRIPTION_TOOL_NAME = "neo_subscribe";

export const MAX_SUBSCRIPTION_WAKES = 10;
export const SUBSCRIPTION_COALESCE_MS = 8_000;

export type SubscriptionEventKind = "pr_activity" | "ci";

export type RunSubscriptionKind = "github_pr" | "github_ci";

export interface RunSubscription {
  id: string;
  runId: string;
  kind: RunSubscriptionKind;
  repo: string;
  prNumber: number | null;
  branch: string | null;
  createdAt: string;
  wakeCount: number;
  lastDeliveryKey: string | null;
  lastDeliveredAt: string | null;
}

export interface CreateSubscriptionRequest {
  events?: SubscriptionEventKind[] | SubscriptionEventKind | "all";
}

const EVENT_KINDS = new Set<SubscriptionEventKind>(["pr_activity", "ci"]);

export function parseSubscriptionEvents(value: unknown): SubscriptionEventKind[] {
  if (value == null || value === "" || value === "all") {
    return ["pr_activity", "ci"];
  }
  const items = Array.isArray(value) ? value : [value];
  const parsed = items.filter((item): item is SubscriptionEventKind => {
    return typeof item === "string" && EVENT_KINDS.has(item as SubscriptionEventKind);
  });
  return parsed.length > 0 ? [...new Set(parsed)] : ["pr_activity", "ci"];
}

export function subscriptionKindForEvent(event: SubscriptionEventKind): RunSubscriptionKind {
  return event === "ci" ? "github_ci" : "github_pr";
}

/** Normalize a GitHub URL, SSH remote, or owner/name into `owner/repo`. */
export function githubRepoSlug(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) {
    return null;
  }
  const stripped = raw.replace(/\.git$/i, "").replace(/\/+$/, "");
  const ssh = /^git@github\.com:([^/]+)\/([^/]+)$/i.exec(stripped);
  if (ssh) {
    return `${ssh[1]}/${ssh[2]}`.toLowerCase();
  }
  const https = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(stripped);
  if (https) {
    return `${https[1]}/${https[2]}`.toLowerCase();
  }
  return null;
}

export function subscriptionTargetsFrom(input: {
  repoUrls?: string[];
  branchName?: string | null;
  pullRequests?: Array<{ repoUrl?: string; url?: string; number?: number | null; branch?: string | null }>;
}): Array<{ repo: string; prNumber: number | null; branch: string | null }> {
  const fromPrs = (input.pullRequests ?? [])
    .map((pr) => {
      const repo = githubRepoSlug(pr.repoUrl) ?? githubRepoSlug(pr.url);
      if (!repo) {
        return null;
      }
      return {
        repo,
        prNumber: typeof pr.number === "number" ? pr.number : null,
        branch: pr.branch || input.branchName || null,
      };
    })
    .filter((item): item is { repo: string; prNumber: number | null; branch: string | null } => Boolean(item));
  if (fromPrs.length > 0) {
    return uniqueTargets(fromPrs);
  }
  const fromRepos = (input.repoUrls ?? [])
    .map((url) => githubRepoSlug(url))
    .filter((item): item is string => Boolean(item))
    .map((repo) => ({ repo, prNumber: null, branch: input.branchName ?? null }));
  return uniqueTargets(fromRepos);
}

function uniqueTargets(
  items: Array<{ repo: string; prNumber: number | null; branch: string | null }>,
): Array<{ repo: string; prNumber: number | null; branch: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ repo: string; prNumber: number | null; branch: string | null }> = [];
  for (const item of items) {
    const key = `${item.repo}#${item.prNumber ?? ""}@${item.branch ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}
