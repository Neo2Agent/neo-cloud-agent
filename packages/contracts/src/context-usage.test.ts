import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_BUCKET_ORDER,
  assembleContextUsage,
  baselineContextUsage,
  estimateTokensFromText,
  formatContextPercent,
  formatTokenCount,
  overlayContextUsage,
  parseContextUsage,
} from "./context-usage.js";

function bucketTokens(usage: { buckets: Array<{ id: string; tokens: number }> }, id: string): number {
  return usage.buckets.find((bucket) => bucket.id === id)?.tokens ?? 0;
}

function bucketSum(usage: { buckets: Array<{ tokens: number }> }): number {
  return usage.buckets.reduce((sum, bucket) => sum + bucket.tokens, 0);
}

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

test("buckets always add up to the reported total", () => {
  const usage = assembleContextUsage({
    model: "deepseek-v4-flash",
    reportedTokens: 20_000,
    systemText: "s".repeat(4000),
    rulesText: "r".repeat(800),
    memoryText: "m".repeat(400),
    skillsText: "k".repeat(600),
    toolsText: "t".repeat(1200),
    cloudToolsText: "c".repeat(1600),
    summarizedText: "z".repeat(900),
    conversationText: "v".repeat(3000),
  });
  assert.equal(usage.tokens, 20_000);
  assert.equal(bucketSum(usage), 20_000);
});

test("the system bucket is what the attributable sections leave behind", () => {
  const rules = "r".repeat(800);
  const memory = "m".repeat(400);
  const skills = "k".repeat(600);
  // The sections are carved out of the system prompt, so they must not be
  // counted twice.
  const systemText = `head${rules}${memory}${skills}tail`;
  const usage = assembleContextUsage({ systemText, rulesText: rules, memoryText: memory, skillsText: skills });
  const attributable =
    estimateTokensFromText(rules) + estimateTokensFromText(memory) + estimateTokensFromText(skills);
  assert.equal(bucketTokens(usage, "system"), estimateTokensFromText(systemText) - attributable);
  assert.equal(bucketSum(usage), usage.tokens);
});

test("a reported total below the fixed prefix is not believed", () => {
  // pi reports a messages-only figure until the first provider usage arrives.
  // Treating it as the whole context would crush every bucket to near zero.
  const usage = assembleContextUsage({
    reportedTokens: 100,
    systemText: "s".repeat(40_000),
    toolsText: "t".repeat(40_000),
    conversationText: "v".repeat(20_000),
  });
  assert.ok(usage.tokens > 100, "falls back to the estimate");
  assert.equal(bucketSum(usage), usage.tokens);
  assert.ok(bucketTokens(usage, "system") > 0);
  assert.ok(bucketTokens(usage, "conversation") > 0);
});

test("a believable reported total still rescales every bucket", () => {
  // Reported sits below the raw estimate but well above the fixed prefix, so it
  // is a real whole-context number and the buckets shrink to match it.
  const usage = assembleContextUsage({
    reportedTokens: 12_000,
    systemText: "s".repeat(20_000),
    toolsText: "t".repeat(20_000),
    conversationText: "v".repeat(40_000),
  });
  assert.equal(usage.tokens, 12_000);
  assert.equal(bucketSum(usage), 12_000);
  assert.ok(bucketTokens(usage, "conversation") > 0);
  assert.ok(bucketTokens(usage, "system") > 0);
});

test("reserved buckets stay hidden until something fills them", () => {
  const idle = assembleContextUsage({ systemText: "sys", toolsText: "tools" });
  assert.equal(idle.buckets.some((bucket) => bucket.id === "mcp"), false);
  assert.equal(idle.buckets.some((bucket) => bucket.id === "subagents"), false);

  const filled = assembleContextUsage({
    reportedTokens: 5_000,
    systemText: "s".repeat(2000),
    mcpText: "dynamic tool schema".repeat(50),
    subagentsText: "agent catalog".repeat(50),
    conversationText: "v".repeat(1000),
  });
  assert.ok(bucketTokens(filled, "mcp") > 0);
  assert.ok(bucketTokens(filled, "subagents") > 0);
  assert.equal(bucketSum(filled), 5_000);
});

test("buckets come back in a stable render order", () => {
  const usage = assembleContextUsage({
    systemText: "s".repeat(400),
    rulesText: "r".repeat(400),
    toolsText: "t".repeat(400),
    conversationText: "v".repeat(400),
  });
  const positions = usage.buckets.map((bucket) => CONTEXT_BUCKET_ORDER.indexOf(bucket.id));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));

  // A payload that arrived out of order still renders in order.
  const parsed = parseContextUsage({
    tokens: 30,
    contextWindow: 1000,
    buckets: [
      { id: "conversation", tokens: 10 },
      { id: "system", tokens: 20 },
    ],
  });
  assert.deepEqual(parsed?.buckets.map((bucket) => bucket.id), ["system", "conversation"]);
});

test("an unknown bucket id is dropped without disturbing the total", () => {
  const parsed = parseContextUsage({
    tokens: 42,
    contextWindow: 1000,
    buckets: [
      { id: "system", tokens: 20 },
      { id: "not-a-bucket", tokens: 22 },
    ],
  });
  assert.equal(parsed?.tokens, 42);
  assert.deepEqual(parsed?.buckets.map((bucket) => bucket.id), ["system"]);
});

test("child items scale to the parent and survive parse", () => {
  const usage = assembleContextUsage({
    toolsText: "read\nwrite\nbash",
    toolItems: [
      { id: "read", label: "read", text: "read schema ".repeat(20) },
      { id: "write", label: "write", text: "write schema ".repeat(8) },
    ],
  });
  const tools = usage.buckets.find((bucket) => bucket.id === "tools");
  assert.ok(tools?.children?.length);
  assert.equal(
    tools!.children!.reduce((sum, item) => sum + item.tokens, 0),
    tools!.tokens,
  );
  const parsed = parseContextUsage({
    tokens: usage.tokens,
    contextWindow: 1000,
    buckets: usage.buckets,
  });
  assert.deepEqual(
    parsed?.buckets.find((bucket) => bucket.id === "tools")?.children?.map((item) => item.id),
    tools!.children!.map((item) => item.id),
  );
});

test("formatTokenCount uses K and M", () => {
  assert.equal(formatTokenCount(283), "283");
  assert.equal(formatTokenCount(1900), "1.9K");
  assert.equal(formatTokenCount(128_000), "128K");
  assert.equal(formatTokenCount(1_000_000), "1M");
});

test("formatContextPercent keeps a used window off zero", () => {
  // 3.4K of a 1M window is real usage, so it must not read as 0%.
  assert.equal(formatContextPercent((3400 / 1_000_000) * 100), "<1%");
  assert.equal(formatContextPercent(0), "0%");
  assert.equal(formatContextPercent(11.93), "12%");
  assert.equal(formatContextPercent(131.4), "131%");
  assert.equal(formatContextPercent(null), null);
});
