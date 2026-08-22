import assert from "node:assert/strict";
import test from "node:test";
import {
  githubRepoSlug,
  parseSubscriptionEvents,
  subscriptionKindForEvent,
  subscriptionTargetsFrom,
} from "./subscription.js";

test("parseSubscriptionEvents defaults to PR activity and CI", () => {
  assert.deepEqual(parseSubscriptionEvents(undefined), ["pr_activity", "ci"]);
  assert.deepEqual(parseSubscriptionEvents("all"), ["pr_activity", "ci"]);
  assert.deepEqual(parseSubscriptionEvents([]), ["pr_activity", "ci"]);
  assert.deepEqual(parseSubscriptionEvents("pr_activity"), ["pr_activity"]);
  assert.deepEqual(parseSubscriptionEvents(["ci", "ci", "nope"]), ["ci"]);
});

test("githubRepoSlug accepts remotes, pages, and owner/name", () => {
  assert.equal(githubRepoSlug("https://github.com/Acme/App.git"), "acme/app");
  assert.equal(githubRepoSlug("git@github.com:Acme/App.git"), "acme/app");
  assert.equal(githubRepoSlug("https://github.com/Acme/App/pull/3"), "acme/app");
  assert.equal(githubRepoSlug("Acme/App"), null);
  assert.equal(githubRepoSlug("fixtures/toy-repo"), null);
  assert.equal(subscriptionKindForEvent("ci"), "github_ci");
});

test("subscriptionTargetsFrom prefers pull requests over repo URLs", () => {
  const targets = subscriptionTargetsFrom({
    repoUrls: ["https://github.com/acme/app", "fixtures/toy-repo"],
    branchName: "neo/demo",
    pullRequests: [
      {
        repoUrl: "https://github.com/acme/app",
        url: "https://github.com/acme/app/pull/3",
        number: 3,
        branch: "cursor/fix",
      },
    ],
  });
  assert.deepEqual(targets, [{ repo: "acme/app", prNumber: 3, branch: "cursor/fix" }]);
  assert.deepEqual(
    subscriptionTargetsFrom({ repoUrls: ["https://github.com/acme/app.git"], branchName: "main" }),
    [{ repo: "acme/app", prNumber: null, branch: "main" }],
  );
});
