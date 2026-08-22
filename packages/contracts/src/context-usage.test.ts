import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleContextUsage,
  baselineContextUsage,
  estimateTokensFromText,
  formatTokenCount,
  overlayContextUsage,
  parseContextUsage,
} from "./context-usage.js";

test("assembleContextUsage does not invent a window without a model", () => {
  const usage = assembleContextUsage({
    systemText: "hello world",
    toolsText: "read write",
    conversationText: "do the thing",
  });
  assert.equal(usage.contextWindow, null);
  assert.equal(usage.percent, null);
  assert.ok(usage.tokens > 0);
});

test("assembleContextUsage takes the window from the selected model", () => {
  const flash = assembleContextUsage({ model: "deepseek-v4-flash", systemText: "sys" });
  const gpt = assembleContextUsage({ model: "gpt-4o-mini", systemText: "sys" });
  assert.equal(flash.contextWindow, 1_000_000);
  assert.equal(gpt.contextWindow, 128_000);
  assert.notEqual(flash.percent, gpt.percent);
});

test("reported session tokens win over text estimates", () => {
  const usage = assembleContextUsage({
    model: "deepseek-v4-flash",
    reportedTokens: 20_000,
    systemText: "sys",
    toolsText: "tools",
    conversationText: "short",
  });
  assert.equal(usage.tokens, 20_000);
  assert.equal(usage.source, "session");
  assert.ok(usage.percent && usage.percent < 3);
});

test("overlay adds the draft onto conversation", () => {
  const base = assembleContextUsage({ model: "gpt-4o-mini", conversationText: "hi" });
  const next = overlayContextUsage(base, { draft: "a".repeat(40) });
  assert.equal(next.tokens, base.tokens + estimateTokensFromText("a".repeat(40)));
  assert.equal(next.contextWindow, 128_000);
});

test("baseline estimate uses the model window and never 128k for DeepSeek", () => {
  const usage = baselineContextUsage("deepseek-v4-pro");
  assert.equal(usage.contextWindow, 1_000_000);
  assert.ok(usage.buckets.some((bucket) => bucket.id === "system"));
  assert.ok(usage.buckets.some((bucket) => bucket.id === "tools"));
});

test("parseContextUsage keeps a null window", () => {
  const parsed = parseContextUsage({ tokens: 12, contextWindow: null, buckets: [] });
  assert.equal(parsed?.contextWindow, null);
  assert.equal(parsed?.percent, null);
});

test("formatTokenCount uses K and M", () => {
  assert.equal(formatTokenCount(283), "283");
  assert.equal(formatTokenCount(1900), "1.9K");
  assert.equal(formatTokenCount(128_000), "128K");
  assert.equal(formatTokenCount(1_000_000), "1M");
});
