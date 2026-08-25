import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTokens,
  formatWhen,
  formatWindow,
  policyLabel,
  preview,
  quotaPercent,
  slotLabel,
  sourceLabel,
  statusLabel,
} from "./format.js";

test("formatWhen uses Shanghai time and drops the current year", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  assert.equal(formatWhen("2026-08-24T09:30:00.000Z", now), "8/24 17:30");
  assert.match(formatWhen("2025-06-01T00:00:00.000Z", now), /2025/);
  assert.equal(formatWhen(null), "—");
});

test("formatTokens compactifies large counts", () => {
  assert.equal(formatTokens(128), "128");
  assert.equal(formatTokens(12_300), "12.3k");
  assert.equal(formatTokens(1_200_000), "1.2M");
});

test("quotaPercent clamps and ignores empty caps", () => {
  assert.equal(quotaPercent(25, 100), 25);
  assert.equal(quotaPercent(200, 100), 100);
  assert.equal(quotaPercent(10, 0), 0);
});

test("formatWindow describes rate-limit windows", () => {
  assert.equal(formatWindow(0), "并发");
  assert.equal(formatWindow(60_000), "1 分钟");
  assert.equal(formatWindow(3_600_000), "1 小时");
  assert.equal(formatWindow(15_000), "15 秒");
});

test("labels stay in Chinese", () => {
  assert.equal(statusLabel("RUNNING"), "运行中");
  assert.equal(sourceLabel("automation"), "定时任务");
  assert.equal(policyLabel("create_run"), "新建对话");
  assert.equal(slotLabel("slot-1"), "槽 2");
  assert.equal(preview("  hello   world  "), "hello world");
});
