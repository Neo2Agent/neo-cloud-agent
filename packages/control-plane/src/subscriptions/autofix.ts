import { MAX_CI_AUTOFIX, type FollowUp, type PullRequestRef, type RunSubscription } from "@neo-cloud-agent/contracts";
import type { GitHubIngress } from "./github.js";

export type SubscriptionWakeDecision =
  | { action: "skip"; reason: string }
  | { action: "watch"; text: string }
  | { action: "autofix"; text: string };

export function isCiSuccess(conclusion?: string | null): boolean {
  const value = (conclusion ?? "").toLowerCase();
  return value === "success" || value === "skipped" || value === "neutral";
}

export function isCiFailure(conclusion?: string | null): boolean {
  const value = (conclusion ?? "").toLowerCase();
  return (
    value === "failure" ||
    value === "timed_out" ||
    value === "timedout" ||
    value === "action_required" ||
    value === "cancelled" ||
    value === "error" ||
    value === "startup_failure"
  );
}

export function hasUserFollowUp(followUps: Array<Pick<FollowUp, "source">>): boolean {
  return followUps.some((item) => item.source === "user");
}

export function runOwnsIngressPr(
  pullRequests: Array<Pick<PullRequestRef, "number">>,
  ingress: Pick<GitHubIngress, "prNumbers">,
): boolean {
  if (ingress.prNumbers.length === 0) {
    return true;
  }
  return pullRequests.some((item) => item.number != null && ingress.prNumbers.includes(item.number));
}

export function formatAutofixText(ingress: Pick<GitHubIngress, "text">, attempt: number, max = MAX_CI_AUTOFIX): string {
  return [
    ingress.text,
    `CI failed (autofix ${attempt}/${max}). Read the failure, fix it, run the project's tests, then neo_git_commit. Do not open a new PR. End the turn when done so the next check can wake this run.`,
  ].join("\n\n");
}

export function decideSubscriptionWake(input: {
  subscription: RunSubscription;
  ingress: GitHubIngress;
  pullRequests: Array<Pick<PullRequestRef, "number">>;
  followUps: Array<Pick<FollowUp, "source">>;
  blockAutofix?: boolean;
}): SubscriptionWakeDecision {
  const { subscription, ingress } = input;
  if (ingress.kind === "human_push") {
    return { action: "skip", reason: "human_push" };
  }
  if (ingress.kind === "pr_activity") {
    return { action: "watch", text: ingress.text };
  }
  if (ingress.kind !== "ci") {
    return { action: "skip", reason: "not_ci" };
  }
  if (isCiSuccess(ingress.conclusion)) {
    return {
      action: "watch",
      text: `${ingress.text}\n\nCI is green. Stop unless review comments still need work.`,
    };
  }
  if (!isCiFailure(ingress.conclusion) && ingress.conclusion) {
    return { action: "skip", reason: "ci_not_actionable" };
  }
  const mode = subscription.mode ?? (subscription.kind === "github_ci" ? "autofix" : "watch");
  if (mode === "watch") {
    return { action: "watch", text: ingress.text };
  }
  if (input.blockAutofix) {
    return { action: "skip", reason: "human_push_blocked" };
  }
  if (hasUserFollowUp(input.followUps)) {
    return { action: "skip", reason: "user_follow_up" };
  }
  if (!runOwnsIngressPr(input.pullRequests, ingress)) {
    return { action: "skip", reason: "foreign_pr" };
  }
  const used = subscription.autofixCount ?? 0;
  if (used >= MAX_CI_AUTOFIX) {
    return { action: "skip", reason: "autofix_exhausted" };
  }
  return { action: "autofix", text: formatAutofixText(ingress, used + 1) };
}
