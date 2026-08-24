import assert from "node:assert/strict";
import test from "node:test";
import { fileToolDiff, formatUsage, modelLabel, parseUnifiedDiff, resolveChatModel, toolArgPreview } from "./format.js";

test("modelLabel distinguishes DeepSeek Flash, Vision, and Pro", () => {
  assert.equal(modelLabel("deepseek", "deepseek-v4-flash"), "DeepSeek Flash");
  assert.equal(modelLabel("deepseek", "deepseek-v4-pro"), "DeepSeek Pro");
  assert.equal(modelLabel("deepseek", "deepseek-v4-flash-vision-exp"), "DeepSeek Flash Vision");
  assert.equal(resolveChatModel("deepseek", "deepseek-v4-flash"), "deepseek-v4-flash");
  assert.equal(resolveChatModel("deepseek", "deepseek-v4-flash", true), "deepseek-v4-flash-vision-exp");
});
  assert.equal(formatUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }), "15 tok");
});

test("toolArgPreview prefers command and path", () => {
  assert.equal(toolArgPreview({ command: "ls -la" }), "ls -la");
  assert.equal(toolArgPreview({ path: "src/app.ts" }), "src/app.ts");
});

test("fileToolDiff renders edit old/new text", () => {
  const diff = fileToolDiff({
    name: "edit",
    args: { path: "README.md", edits: [{ oldText: "hello", newText: "world" }] },
  });
  assert.equal(diff?.path, "README.md");
  assert.deepEqual(diff?.lines, [
    { type: "del", text: "hello" },
    { type: "add", text: "world" },
  ]);
});

test("fileToolDiff prefers persisted unified diff details", () => {
  const diff = fileToolDiff({
    name: "edit",
    args: { path: "a.ts" },
    details: { diff: "--- a\n+++ b\n@@\n-old\n+new\n" },
  });
  assert.deepEqual(
    diff?.lines.map((line) => `${line.type}:${line.text}`),
    ["del:old", "add:new"],
  );
  assert.ok(parseUnifiedDiff("+ok\n").length === 1);
});
