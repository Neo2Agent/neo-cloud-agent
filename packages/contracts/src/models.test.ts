import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REQUEST_OUTPUT_TOKENS, resolveModelLimits, resolveRequestMaxTokens } from "./models.js";

test("DeepSeek V4 flash and pro both advertise a 1M window", () => {
  assert.deepEqual(resolveModelLimits("deepseek-v4-flash"), {
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
  });
  assert.deepEqual(resolveModelLimits("neo/deepseek"), {
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
  });
  assert.deepEqual(resolveModelLimits("deepseek-v4-pro"), {
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
  });
  assert.deepEqual(resolveModelLimits("deepseek-v4-flash-vision-exp"), {
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
  });
});

test("OpenAI 4o family uses 128k, not DeepSeek's 1M", () => {
  assert.equal(resolveModelLimits("gpt-4o-mini")?.contextWindow, 128_000);
  assert.equal(resolveModelLimits("gpt-4o")?.contextWindow, 128_000);
  assert.notEqual(resolveModelLimits("gpt-4o-mini")?.contextWindow, resolveModelLimits("deepseek-v4-flash")?.contextWindow);
});

test("unknown models have no invented window", () => {
  assert.equal(resolveModelLimits("some-local-70b"), null);
  assert.equal(resolveModelLimits(""), null);
  assert.equal(resolveModelLimits(undefined), null);
});

test("request max tokens cap DeepSeek's 384k reservation without shrinking GPT-4o", () => {
  assert.equal(resolveRequestMaxTokens("deepseek-v4-flash"), MAX_REQUEST_OUTPUT_TOKENS);
  assert.equal(resolveRequestMaxTokens("deepseek-v4-pro"), MAX_REQUEST_OUTPUT_TOKENS);
  assert.ok(resolveRequestMaxTokens("deepseek-v4-flash") < (resolveModelLimits("deepseek-v4-flash")?.maxOutputTokens ?? 0));
  assert.equal(resolveRequestMaxTokens("gpt-4o-mini"), 16_384);
  assert.equal(resolveRequestMaxTokens("mystery-local"), 8192);
});
