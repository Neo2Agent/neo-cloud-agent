import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, resolveChatModel, toolArgPreview } from "./format.js";

test("formatDuration prints seconds then minutes", () => {
  assert.equal(formatDuration("2026-09-01T00:00:00Z", "2026-09-01T00:00:12Z"), "12s");
  assert.equal(formatDuration("2026-09-01T00:00:00Z", "2026-09-01T00:03:02Z"), "3m2s");
  assert.equal(formatDuration("2026-09-01T00:00:00Z", "2026-09-01T00:02:00Z"), "2m");
  assert.equal(formatDuration("nope", "2026-09-01T00:00:12Z"), "");
});

test("resolveChatModel switches to vision when images are attached", () => {
  assert.equal(resolveChatModel("deepseek", "deepseek-v4-flash", true), "deepseek-v4-flash-vision-exp");
  assert.equal(resolveChatModel("deepseek", "deepseek-v4-pro", false), "deepseek-v4-pro");
  assert.equal(resolveChatModel("openai", "gpt-4o", true), "gpt-4o-mini");
});

test("toolArgPreview prefers bash command and path", () => {
  assert.equal(toolArgPreview({ command: "ls -la" }), "ls -la");
  assert.equal(toolArgPreview({ path: "src/app.ts" }), "src/app.ts");
  assert.equal(toolArgPreview({ agent: "scout", task: "look around" }), "scout: look around");
});
