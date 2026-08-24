import assert from "node:assert/strict";
import test from "node:test";
import type { Run } from "@neo-cloud-agent/contracts";
import { assertCreateRunAllowed, concurrentRunsForOrg, QuotaError, usedTokensThisMonth } from "./quota.js";

function run(partial: Partial<Run>): Run {
  return {
    id: partial.id ?? "r1",
    orgId: partial.orgId ?? "org",
    userId: "u",
    envId: null,
    envVersionId: null,
    buildId: null,
    status: partial.status ?? "IDLE",
    setupStatus: null,
    source: "web",
    model: "deepseek-v4-flash",
    prompt: "x",
    branchName: null,
    baseBranch: null,
    repoUrls: [],
    pullRequests: [],
    workerHandle: null,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    idleAt: null,
    expiresAt: null,
    errorMessage: null,
    usage: partial.usage ?? null,
  };
}

test("monthly token rollup ignores other orgs and last month", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  const used = usedTokensThisMonth(
    [
      run({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, createdAt: "2026-08-02T00:00:00.000Z" }),
      run({ orgId: "other", usage: { promptTokens: 99, completionTokens: 1, totalTokens: 100 }, createdAt: "2026-08-02T00:00:00.000Z" }),
      run({ usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 }, createdAt: "2026-07-30T00:00:00.000Z" }),
    ],
    "org",
    now,
  );
  assert.equal(used, 15);
});

test("assertCreateRunAllowed throws 429 when over concurrent or tokens", () => {
  const previousTokens = process.env.QUOTA_MAX_TOKENS_MONTH;
  const previousConcurrent = process.env.QUOTA_MAX_CONCURRENT_RUNS;
  process.env.QUOTA_MAX_CONCURRENT_RUNS = "1";
  process.env.QUOTA_MAX_TOKENS_MONTH = "10";
  try {
    assert.equal(concurrentRunsForOrg([run({ status: "RUNNING" })], "org"), 1);
    assert.throws(
      () => assertCreateRunAllowed([run({ status: "RUNNING" })], "org"),
      (error: unknown) => error instanceof QuotaError && error.status === 429,
    );
    assert.throws(
      () =>
        assertCreateRunAllowed(
          [run({ status: "IDLE", usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 } })],
          "org",
        ),
      /monthly tokens/,
    );
  } finally {
    if (previousTokens === undefined) delete process.env.QUOTA_MAX_TOKENS_MONTH;
    else process.env.QUOTA_MAX_TOKENS_MONTH = previousTokens;
    if (previousConcurrent === undefined) delete process.env.QUOTA_MAX_CONCURRENT_RUNS;
    else process.env.QUOTA_MAX_CONCURRENT_RUNS = previousConcurrent;
  }
});
