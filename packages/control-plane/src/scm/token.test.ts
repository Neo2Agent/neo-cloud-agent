import assert from "node:assert/strict";
import test from "node:test";
import { mintGitToken, resetGitTokens, scmPushToken, verifyGitToken } from "./token.js";

test("mints a short-lived broker token that is not the GitHub PAT", () => {
  resetGitTokens();
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "ghp-long-lived-secret";
  try {
    const issued = mintGitToken({
      runId: "run-1",
      repoUrl: "github.com/acme/app",
      scope: "push",
      ttlMs: 60_000,
    });
    assert.match(issued.token, /^neo\.git\./);
    assert.doesNotMatch(issued.token, /ghp-long-lived-secret/);
    assert.equal(issued.scope, "push");
    const verified = verifyGitToken(issued.token);
    assert.equal(verified.runId, "run-1");
    assert.equal(scmPushToken(), "ghp-long-lived-secret");
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
});

test("push tokens can be consumed once", () => {
  resetGitTokens();
  const issued = mintGitToken({ runId: "run-2", repoUrl: "fixtures/toy-repo", scope: "push" });
  verifyGitToken(issued.token, { consume: true });
  assert.throws(() => verifyGitToken(issued.token, { consume: true }), /already used/);
});

test("expired tokens are rejected", () => {
  resetGitTokens();
  const issued = mintGitToken({
    runId: "run-3",
    repoUrl: "fixtures/toy-repo",
    scope: "clone",
    ttlMs: -1,
  });
  assert.throws(() => verifyGitToken(issued.token), /expired|invalid/);
});
