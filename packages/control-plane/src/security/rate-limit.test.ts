import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRedis } from "../events/redis.js";
import {
  acquireConcurrency,
  actorRateLimitPolicies,
  attachRateLimitRedis,
  consumeRateLimit,
  isRateLimitExempt,
  peekRateLimit,
  publicRateLimitPolicies,
  rateLimitEnabled,
  rateLimitStoreKind,
  resetRateLimitStore,
} from "./rate-limit.js";

test("rate limiting stays off in the test runner unless RATE_LIMIT=1", () => {
  const previous = process.env.RATE_LIMIT;
  delete process.env.RATE_LIMIT;
  try {
    assert.equal(Boolean(process.env.NODE_TEST_CONTEXT), true);
    assert.equal(rateLimitEnabled(), false);
    process.env.RATE_LIMIT = "1";
    assert.equal(rateLimitEnabled(), true);
    process.env.RATE_LIMIT = "0";
    assert.equal(rateLimitEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.RATE_LIMIT;
    else process.env.RATE_LIMIT = previous;
  }
});

test("token bucket allows a burst then denies until refill", async () => {
  const previous = process.env.RATE_LIMIT;
  process.env.RATE_LIMIT = "1";
  resetRateLimitStore();
  attachRateLimitRedis(null);
  try {
    const spec = { limit: 4, windowMs: 60_000, burst: 2, kind: "token" as const };
    const first = await consumeRateLimit("api", "user:a", { spec });
    const second = await consumeRateLimit("api", "user:a", { spec });
    const denied = await consumeRateLimit("api", "user:a", { spec });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(denied.ok, false);
    assert.equal(denied.policy, "api");
    assert.ok(denied.retryAfterMs > 0);
    const other = await consumeRateLimit("api", "user:b", { spec });
    assert.equal(other.ok, true);
  } finally {
    resetRateLimitStore();
    if (previous === undefined) delete process.env.RATE_LIMIT;
    else process.env.RATE_LIMIT = previous;
  }
});

test("SSE concurrency leases release so the next subscriber can attach", async () => {
  const previous = process.env.RATE_LIMIT;
  process.env.RATE_LIMIT = "1";
  resetRateLimitStore();
  try {
    const spec = { limit: 1, windowMs: 0, burst: 1, kind: "concurrency" as const };
    const first = await acquireConcurrency("sse", "user:live", { spec });
    const blocked = await acquireConcurrency("sse", "user:live", { spec });
    assert.equal(first.ok, true);
    assert.equal(blocked.ok, false);
    first.release();
    first.release();
    const again = await acquireConcurrency("sse", "user:live", { spec });
    assert.equal(again.ok, true);
    again.release();
  } finally {
    resetRateLimitStore();
    if (previous === undefined) delete process.env.RATE_LIMIT;
    else process.env.RATE_LIMIT = previous;
  }
});

test("Redis fixed window counts across consume and peek", async () => {
  const previous = process.env.RATE_LIMIT;
  process.env.RATE_LIMIT = "1";
  resetRateLimitStore();
  const redis = createMemoryRedis();
  attachRateLimitRedis(redis);
  try {
    assert.equal(rateLimitStoreKind(), "redis");
    const spec = { limit: 2, windowMs: 60_000, burst: 2, kind: "token" as const };
    assert.equal((await consumeRateLimit("ip", "1.2.3.4", { spec })).ok, true);
    assert.equal((await consumeRateLimit("ip", "1.2.3.4", { spec })).ok, true);
    const denied = await consumeRateLimit("ip", "1.2.3.4", { spec });
    assert.equal(denied.ok, false);
    const peeked = await peekRateLimit("ip", "1.2.3.4", { spec });
    assert.equal(peeked.remaining, 0);
    assert.equal((await consumeRateLimit("ip", "8.8.8.8", { spec })).ok, true);
  } finally {
    attachRateLimitRedis(null);
    resetRateLimitStore();
    if (previous === undefined) delete process.env.RATE_LIMIT;
    else process.env.RATE_LIMIT = previous;
  }
});

test("route classifiers skip health/internal/static and stack write policies", () => {
  assert.equal(isRateLimitExempt("GET", "/health"), true);
  assert.equal(isRateLimitExempt("GET", "/internal/runs/r1/inbox"), true);
  assert.equal(isRateLimitExempt("GET", "/assets/app.js"), true);
  assert.deepEqual(publicRateLimitPolicies("POST", "/v1/auth/login"), ["ip", "login"]);
  assert.deepEqual(publicRateLimitPolicies("POST", "/webhooks/github"), ["ip", "webhook"]);
  assert.deepEqual(actorRateLimitPolicies("POST", "/v1/runs"), ["api", "write", "create_run"]);
  assert.deepEqual(actorRateLimitPolicies("POST", "/v1/runs/r1/follow-ups"), ["api", "write", "follow_up"]);
  assert.deepEqual(actorRateLimitPolicies("POST", "/v1/builds"), ["api", "write", "expensive"]);
  assert.deepEqual(actorRateLimitPolicies("GET", "/v1/runs"), ["api"]);
  assert.deepEqual(actorRateLimitPolicies("POST", "/v1/auth/login"), []);
  assert.deepEqual(publicRateLimitPolicies("POST", "/v1/speech/iat"), []);
  assert.deepEqual(actorRateLimitPolicies("POST", "/v1/speech/iat"), ["speech"]);
  assert.deepEqual(actorRateLimitPolicies("GET", "/v1/speech/iat"), ["api"]);
  assert.deepEqual(actorRateLimitPolicies("POST", "/v1/runs/r1/term/term_1"), ["term"]);
  assert.deepEqual(actorRateLimitPolicies("POST", "/v1/runs/r1/term"), ["api", "write"]);
});
