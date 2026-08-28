import type { RunSubscription } from "@neo-cloud-agent/contracts";

export type GitHubIngressKind = "pr_activity" | "ci" | "human_push" | "ping" | "ignored";

export type GitHubIngress = {
  kind: GitHubIngressKind;
  deliveryKey: string;
  repo: string | null;
  prNumbers: number[];
  branches: string[];
  text: string;
  actor?: string | null;
  conclusion?: string | null;
};

const BOT_LOGINS = new Set([
  "github-actions",
  "github-actions[bot]",
  "dependabot",
  "dependabot[bot]",
  "renovate",
  "renovate[bot]",
  "cursor",
  "cursor[bot]",
  "neo-cloud-agent",
  "neo-cloud-agent[bot]",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function loginOf(value: unknown): string {
  return asString(asRecord(value)?.login).toLowerCase();
}

function isBotLogin(login: string): boolean {
  const name = login.toLowerCase();
  return !name ? false : BOT_LOGINS.has(name) || name.endsWith("[bot]");
}

function repoFrom(payload: Record<string, unknown>): string | null {
  const repo = asRecord(payload.repository);
  const full = asString(repo?.full_name);
  return full ? full.toLowerCase() : null;
}

function numbersFrom(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: number[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const number = asNumber(record?.number);
    if (number != null) {
      out.push(number);
    }
  }
  return out;
}

function branchesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = asRecord(item);
      return asString(record?.name || record?.ref);
    })
    .filter(Boolean);
}

function clip(text: string, max = 4000): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}\n…` : trimmed;
}

export function parseGitHubWebhook(eventName: string, payload: unknown, deliveryId?: string): GitHubIngress {
  const body = asRecord(payload) ?? {};
  const repo = repoFrom(body);
  const delivery = deliveryId || asString(body.delivery) || "unknown";

  if (eventName === "ping") {
    return {
      kind: "ping",
      deliveryKey: `ping:${delivery}`,
      repo,
      prNumbers: [],
      branches: [],
      text: asString(body.zen) || "GitHub ping",
    };
  }

  if (eventName === "issue_comment") {
    const issue = asRecord(body.issue);
    const comment = asRecord(body.comment);
    const action = asString(body.action) || "created";
    const prUrl = asString(asRecord(issue?.pull_request)?.url || asRecord(issue?.pull_request)?.html_url);
    const number = asNumber(issue?.number);
    const actor = loginOf(body.sender) || loginOf(comment?.user);
    if (!prUrl || number == null || action === "deleted" || isBotLogin(actor)) {
      return ignored(repo, `issue_comment:${asNumber(comment?.id) ?? delivery}`);
    }
    const url = asString(comment?.html_url);
    return {
      kind: "pr_activity",
      deliveryKey: `issue_comment:${asNumber(comment?.id) ?? delivery}`,
      repo,
      prNumbers: [number],
      branches: [],
      actor,
      text: [
        `[GitHub] PR comment on ${repo ?? "repo"}#${number} by ${actor || "someone"}:`,
        clip(asString(comment?.body)),
        url,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (eventName === "pull_request_review") {
    const review = asRecord(body.review);
    const pull = asRecord(body.pull_request);
    const action = asString(body.action) || "submitted";
    const number = asNumber(pull?.number);
    const actor = loginOf(body.sender) || loginOf(review?.user);
    if (number == null || action === "dismissed" || isBotLogin(actor)) {
      return ignored(repo, `pull_request_review:${asNumber(review?.id) ?? delivery}`);
    }
    return {
      kind: "pr_activity",
      deliveryKey: `pull_request_review:${asNumber(review?.id) ?? delivery}:${action}`,
      repo,
      prNumbers: [number],
      branches: [asString(asRecord(pull?.head)?.ref)].filter(Boolean),
      actor,
      text: [
        `[GitHub] Review ${asString(review?.state) || action} on ${repo ?? "repo"}#${number} by ${actor || "someone"}:`,
        clip(asString(review?.body)),
        asString(review?.html_url) || asString(pull?.html_url),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (eventName === "pull_request_review_comment") {
    const comment = asRecord(body.comment);
    const pull = asRecord(body.pull_request);
    const action = asString(body.action) || "created";
    const number = asNumber(pull?.number);
    const actor = loginOf(body.sender) || loginOf(comment?.user);
    if (number == null || action === "deleted" || isBotLogin(actor)) {
      return ignored(repo, `pull_request_review_comment:${asNumber(comment?.id) ?? delivery}`);
    }
    return {
      kind: "pr_activity",
      deliveryKey: `pull_request_review_comment:${asNumber(comment?.id) ?? delivery}`,
      repo,
      prNumbers: [number],
      branches: [asString(asRecord(pull?.head)?.ref)].filter(Boolean),
      actor,
      text: [
        `[GitHub] Review comment on ${repo ?? "repo"}#${number} by ${actor || "someone"}:`,
        clip(asString(comment?.body)),
        asString(comment?.html_url),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (eventName === "check_suite" || eventName === "check_run" || eventName === "workflow_run") {
    const node = asRecord(body.check_suite) ?? asRecord(body.check_run) ?? asRecord(body.workflow_run) ?? body;
    const action = asString(body.action);
    const conclusion = asString(node.conclusion) || asString(body.conclusion);
    const status = asString(node.status) || asString(body.status);
    if (action && action !== "completed") {
      return ignored(repo, `${eventName}:${asNumber(node.id) ?? delivery}:${action}`);
    }
    if (status && status !== "completed") {
      return ignored(repo, `${eventName}:${asNumber(node.id) ?? delivery}:${status}`);
    }
    const prs = numbersFrom(node.pull_requests);
    const branch = asString(node.head_branch) || asString(asRecord(node.head)?.ref);
    const name = asString(node.name) || asString(asRecord(node.workflow)?.name) || eventName;
    const url = asString(node.html_url);
    const label = conclusion || status || "completed";
    return {
      kind: "ci",
      deliveryKey: `${eventName}:${asNumber(node.id) ?? delivery}:${label}`,
      repo,
      prNumbers: prs,
      branches: [branch].filter(Boolean),
      conclusion: conclusion || null,
      text: [
        `[GitHub] CI ${label} on ${repo ?? "repo"}${prs[0] ? `#${prs[0]}` : ""}`,
        branch ? `Branch: ${branch}` : "",
        `${name}: ${label}`,
        url,
        "This is a GitHub subscription event. Continue if the run still needs work.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (eventName === "push") {
    const actor = loginOf(body.sender);
    const ref = asString(body.ref);
    const branch = ref.replace(/^refs\/heads\//, "");
    if (!branch || ref.startsWith("refs/tags/") || body.deleted === true || isBotLogin(actor)) {
      return ignored(repo, `push:${asString(body.after) || delivery}`);
    }
    return {
      kind: "human_push",
      deliveryKey: `push:${asString(body.after) || delivery}:${branch}`,
      repo,
      prNumbers: [],
      branches: [branch],
      actor,
      text: `[GitHub] Human push on ${repo ?? "repo"} ${branch} by ${actor || "someone"}`,
    };
  }

  if (eventName === "status") {
    const state = asString(body.state);
    if (!state || state === "pending") {
      return ignored(repo, `status:${asString(body.sha) || delivery}:${state || "pending"}`);
    }
    return {
      kind: "ci",
      deliveryKey: `status:${asString(body.sha) || delivery}:${state}`,
      repo,
      prNumbers: numbersFrom(body.pull_requests),
      branches: branchesFrom(body.branches),
      conclusion: state,
      text: [
        `[GitHub] Status ${state} on ${repo ?? "repo"}`,
        asString(body.context) ? `Check: ${asString(body.context)}` : "",
        clip(asString(body.description)),
        asString(body.target_url),
        "This is a GitHub subscription event. Continue if the run still needs work.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return ignored(repo, `${eventName}:${delivery}`);
}

function ignored(repo: string | null, deliveryKey: string): GitHubIngress {
  return {
    kind: "ignored",
    deliveryKey,
    repo,
    prNumbers: [],
    branches: [],
    text: "",
  };
}

export function subscriptionMatchesIngress(subscription: RunSubscription, ingress: GitHubIngress): boolean {
  if (ingress.kind === "ping" || ingress.kind === "ignored") {
    return false;
  }
  if (!ingress.repo || subscription.repo !== ingress.repo) {
    return false;
  }
  if (ingress.kind === "human_push") {
    if (subscription.branch && ingress.branches.length > 0) {
      return ingress.branches.includes(subscription.branch);
    }
    return true;
  }
  if (subscription.kind === "github_pr" && ingress.kind !== "pr_activity") {
    return false;
  }
  if (subscription.kind === "github_ci" && ingress.kind !== "ci") {
    return false;
  }
  if (subscription.prNumber != null) {
    if (ingress.prNumbers.includes(subscription.prNumber)) {
      return true;
    }
    if (ingress.prNumbers.length > 0) {
      return false;
    }
  }
  if (subscription.branch && ingress.branches.length > 0) {
    return ingress.branches.includes(subscription.branch);
  }
  if (subscription.prNumber == null && ingress.prNumbers.length === 0 && ingress.branches.length === 0) {
    return true;
  }
  return subscription.prNumber == null && (ingress.prNumbers.length > 0 || ingress.branches.length > 0);
}
