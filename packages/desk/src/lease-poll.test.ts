import assert from "node:assert/strict";
import test from "node:test";
import { classifyLeaseFailure, leaseRetryDelayMs, leaseUserError } from "./lease-poll.js";

test("a rate-limited lease heartbeat is not shown under the composer", () => {
  assert.equal(classifyLeaseFailure("rate_limited"), "limited");
  assert.equal(leaseUserError("rate_limited"), null);
  assert.equal(leaseUserError("本机保活失败：rate_limited"), null);
});

test("a rate-limited lease backs off instead of polling every two seconds", () => {
  assert.equal(leaseRetryDelayMs("limited", 1), 15_000);
  assert.ok(leaseRetryDelayMs("limited", 3) >= 30_000);
  assert.equal(leaseRetryDelayMs("ok", 4), 1_000);
  assert.equal(leaseRetryDelayMs("down", 1), 2_000);
});

test("auth and real lease failures still surface", () => {
  assert.equal(classifyLeaseFailure("unauthorized"), "auth");
  assert.equal(leaseUserError("socket hang up"), "本机保活失败：socket hang up");
});
