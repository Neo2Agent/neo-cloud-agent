import assert from "node:assert/strict";
import test from "node:test";
import {
  IDLE_LOOKBACK_MS,
  IDLE_SETTLE_MS,
  MEMORY_EXTRACT_TICK_MS,
  isIdleRunDueForExtract,
  type IdleExtractRun,
} from "./idle-extract.js";

const NOW = Date.parse("2026-09-06T12:00:00.000Z");

function run(overrides: Partial<IdleExtractRun> = {}): IdleExtractRun {
  return {
    id: "run_idle",
    userId: "user_1",
    status: "IDLE",
    idleAt: new Date(NOW - IDLE_SETTLE_MS).toISOString(),
    ...overrides,
  };
}

test("memory extract ticks every 5 minutes, not every 30 seconds", () => {
  assert.equal(MEMORY_EXTRACT_TICK_MS, 5 * 60 * 1000);
});

test("idle extract waits 10 minutes then stops looking past 36 hours", () => {
  const extracted = new Set<string>();
  const seen = (id: string) => extracted.has(id);
  assert.equal(isIdleRunDueForExtract(run({ idleAt: new Date(NOW - IDLE_SETTLE_MS + 1).toISOString() }), NOW, seen), false);
  assert.equal(isIdleRunDueForExtract(run(), NOW, seen), true);
  assert.equal(isIdleRunDueForExtract(run({ idleAt: new Date(NOW - IDLE_LOOKBACK_MS).toISOString() }), NOW, seen), true);
  assert.equal(isIdleRunDueForExtract(run({ idleAt: new Date(NOW - IDLE_LOOKBACK_MS - 1).toISOString() }), NOW, seen), false);
});

test("idle extract skips running chats and already extracted runs", () => {
  const extracted = new Set(["run_done"]);
  const seen = (id: string) => extracted.has(id);
  assert.equal(isIdleRunDueForExtract(run({ status: "RUNNING" }), NOW, seen), false);
  assert.equal(isIdleRunDueForExtract(run({ userId: null }), NOW, seen), false);
  assert.equal(isIdleRunDueForExtract(run({ idleAt: null }), NOW, seen), false);
  assert.equal(isIdleRunDueForExtract(run({ idleAt: "not-a-date" }), NOW, seen), false);
  assert.equal(isIdleRunDueForExtract(run({ id: "run_done" }), NOW, seen), false);
});
