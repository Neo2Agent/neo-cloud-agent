import assert from "node:assert/strict";
import test from "node:test";
import { decideSubscriptionWake, isCiFailure, isCiSuccess } from "./autofix.js";
import type { GitHubIngress } from "./github.js";
import type { RunSubscription } from "@neo-cloud-agent/contracts";

function sub(overrides: Partial<RunSubscription> = {}): RunSubscription {
  return {
    id: "sub",
    runId: "run",
    kind: "github_ci",
    repo: "acme/app",
    prNumber: 3,
    branch: "neo/x",
    createdAt: new Date().toISOString(),
    wakeCount: 0,
    lastDeliveryKey: null,
    lastDeliveredAt: null,
    mode: "autofix",
    autofixCount: 0,
    ...overrides,
  };
}

function ci(conclusion: string): GitHubIngress {
  return {
    kind: "ci",
    deliveryKey: `ci:${conclusion}`,
    repo: "acme/app",
    prNumbers: [3],
    branches: ["neo/x"],
    conclusion,
    text: `[GitHub] CI ${conclusion} on acme/app#3`,
  };
}

test("CI success is a watch wake, not autofix", () => {
  assert.equal(isCiSuccess("success"), true);
  const decision = decideSubscriptionWake({
    subscription: sub(),
    ingress: ci("success"),
    pullRequests: [{ number: 3 }],
    followUps: [],
  });
  assert.equal(decision.action, "watch");
  assert.match(decision.action === "watch" ? decision.text : "", /green/i);
});

test("CI failure autofixes until the cap, then stops", () => {
  assert.equal(isCiFailure("failure"), true);
  const first = decideSubscriptionWake({
    subscription: sub(),
    ingress: ci("failure"),
    pullRequests: [{ number: 3 }],
    followUps: [],
  });
  assert.equal(first.action, "autofix");
  assert.match(first.action === "autofix" ? first.text : "", /autofix 1\/3/);
  const exhausted = decideSubscriptionWake({
    subscription: sub({ autofixCount: 3 }),
    ingress: ci("failure"),
    pullRequests: [{ number: 3 }],
    followUps: [],
  });
  assert.equal(exhausted.action, "skip");
  assert.equal(exhausted.action === "skip" ? exhausted.reason : "", "autofix_exhausted");
});

test("a delivered user follow-up without images still blocks autofix", () => {
  assert.equal(
    decideSubscriptionWake({
      subscription: sub(),
      ingress: ci("failure"),
      pullRequests: [{ number: 3 }],
      followUps: [{ source: "user" }],
    }).action,
    "skip",
  );
});

test("user follow-up or human push or a foreign PR blocks autofix", () => {
  assert.equal(
    decideSubscriptionWake({
      subscription: sub(),
      ingress: ci("failure"),
      pullRequests: [{ number: 3 }],
      followUps: [{ source: "user" }],
    }).action,
    "skip",
  );
  assert.equal(
    decideSubscriptionWake({
      subscription: sub(),
      ingress: ci("failure"),
      pullRequests: [{ number: 3 }],
      followUps: [],
      blockAutofix: true,
    }).action,
    "skip",
  );
  assert.equal(
    decideSubscriptionWake({
      subscription: sub(),
      ingress: { ...ci("failure"), prNumbers: [99] },
      pullRequests: [{ number: 3 }],
      followUps: [],
    }).action,
    "skip",
  );
});
