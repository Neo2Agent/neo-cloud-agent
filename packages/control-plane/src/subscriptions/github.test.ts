import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { RunSubscription } from "@neo-cloud-agent/contracts";
import { parseGitHubWebhook, subscriptionMatchesIngress } from "./github.js";
import { verifyGitHubSignature } from "./secret.js";

function sub(partial: Partial<RunSubscription>): RunSubscription {
  return {
    id: "sub-1",
    runId: "run-1",
    kind: "github_pr",
    repo: "acme/app",
    prNumber: 3,
    branch: "cursor/fix",
    createdAt: "2026-08-22T00:00:00.000Z",
    wakeCount: 0,
    lastDeliveryKey: null,
    lastDeliveredAt: null,
    ...partial,
  };
}

test("parseGitHubWebhook extracts PR comments and ignores bots", () => {
  const comment = parseGitHubWebhook("issue_comment", {
    action: "created",
    issue: { number: 3, pull_request: { url: "https://api.github.com/repos/acme/app/pulls/3" } },
    comment: { id: 99, body: "please fix the null check", html_url: "https://github.com/acme/app/pull/3#issuecomment-99", user: { login: "alice" } },
    repository: { full_name: "Acme/App" },
    sender: { login: "alice" },
  });
  assert.equal(comment.kind, "pr_activity");
  assert.deepEqual(comment.prNumbers, [3]);
  assert.equal(comment.repo, "acme/app");
  assert.match(comment.text, /alice/);
  const bot = parseGitHubWebhook("issue_comment", {
    action: "created",
    issue: { number: 3, pull_request: { url: "https://example/pull/3" } },
    comment: { id: 100, body: "auto", user: { login: "github-actions[bot]" } },
    repository: { full_name: "acme/app" },
  });
  assert.equal(bot.kind, "ignored");
});

test("parseGitHubWebhook wakes on completed Actions and skips in-progress", () => {
  const failed = parseGitHubWebhook("workflow_run", {
    action: "completed",
    workflow_run: {
      id: 77,
      name: "test",
      conclusion: "failure",
      status: "completed",
      head_branch: "cursor/fix",
      html_url: "https://github.com/acme/app/actions/runs/77",
      pull_requests: [{ number: 3 }],
    },
    repository: { full_name: "acme/app" },
  });
  assert.equal(failed.kind, "ci");
  assert.match(failed.text, /failure/);
  const pending = parseGitHubWebhook("workflow_run", {
    action: "in_progress",
    workflow_run: { id: 78, status: "in_progress", head_branch: "cursor/fix" },
    repository: { full_name: "acme/app" },
  });
  assert.equal(pending.kind, "ignored");
});

test("subscriptionMatchesIngress binds repo, PR, and branch", () => {
  const comment = parseGitHubWebhook(
    "pull_request_review_comment",
    {
      action: "created",
      pull_request: { number: 3, head: { ref: "cursor/fix" } },
      comment: { id: 5, body: "nits", html_url: "https://github.com/acme/app/pull/3#discussion_r5", user: { login: "bob" } },
      repository: { full_name: "acme/app" },
    },
    "deliv-1",
  );
  assert.equal(subscriptionMatchesIngress(sub({ kind: "github_pr" }), comment), true);
  assert.equal(subscriptionMatchesIngress(sub({ kind: "github_ci" }), comment), false);
  assert.equal(subscriptionMatchesIngress(sub({ prNumber: 9 }), comment), false);
  const ci = parseGitHubWebhook("check_suite", {
    action: "completed",
    check_suite: { id: 1, conclusion: "success", status: "completed", head_branch: "cursor/fix", pull_requests: [] },
    repository: { full_name: "acme/app" },
  });
  assert.equal(subscriptionMatchesIngress(sub({ kind: "github_ci", prNumber: null }), ci), true);
  assert.equal(subscriptionMatchesIngress(sub({ kind: "github_ci", repo: "other/app", prNumber: null }), ci), false);
});

test("verifyGitHubSignature checks the hex HMAC", () => {
  const raw = Buffer.from('{"ok":true}');
  const digest = createHmac("sha256", "top-secret").update(raw).digest("hex");
  assert.equal(verifyGitHubSignature(raw, "top-secret", `sha256=${digest}`), true);
  assert.equal(verifyGitHubSignature(raw, "top-secret", "sha256=deadbeef"), false);
  assert.equal(verifyGitHubSignature(raw, "top-secret", undefined), false);
});
