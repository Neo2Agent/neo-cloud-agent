import assert from "node:assert/strict";
import test from "node:test";
import {
  fileCardPreview,
  fileToolDiff,
  parseUnifiedDiff,
  partitionTurn,
  previewWorkTools,
  resolveFoldOpen,
  toolChromeKind,
  toolDiffStat,
  toolGroupSummary,
  toolLinkLabel,
  toolVerb,
  workGroupLabel,
} from "./work-view.js";

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

test("tool rows use a verb and a group summary with diff stats", () => {
  assert.equal(toolVerb("bash"), "执行");
  assert.equal(toolVerb("neo_browse"), "浏览");
  assert.equal(toolVerb("neo_subagent"), "子任务");
  const edit = {
    name: "edit",
    args: { path: "a.ts", edits: [{ oldText: "old", newText: "new" }] },
  };
  assert.deepEqual(toolDiffStat(edit), { added: 1, removed: 1 });
  assert.equal(
    toolGroupSummary([
      edit,
      { name: "read", args: { path: "b.ts" } },
      { name: "neo_browse", args: { url: "https://example.com" } },
    ]),
    "编辑 1 个文件，读取 1 个文件，浏览 1 个页面 +1 -1",
  );
});

test("partitionTurn keeps the reply outside the work fold", () => {
  const turn = partitionTurn([
    { type: "text", text: "先看一下" },
    {
      type: "tools",
      tools: [
        { name: "neo_browse", args: { url: "https://example.com" } },
        { name: "neo_browse", args: { url: "https://news.ycombinator.com" } },
        { name: "bash", args: { command: "date" } },
        { name: "neo_subagent", args: { agent: "review", task: "看一下" } },
      ],
    },
    { type: "text", text: "结论在这里" },
  ]);
  assert.deepEqual(turn.notes, ["先看一下"]);
  assert.equal(turn.answer, "结论在这里");
  assert.equal(turn.buckets.find((bucket) => bucket.id === "explore")?.label, "浏览 2 个页面");
  assert.equal(turn.buckets.find((bucket) => bucket.id === "exec")?.tools.length, 1);
  assert.equal(turn.buckets.find((bucket) => bucket.id === "other")?.tools[0]?.name, "neo_subagent");
  assert.equal(partitionTurn([{ type: "text", text: "只有话" }]).answer, "只有话");
  assert.equal(resolveFoldOpen(true, null), true);
  assert.equal(resolveFoldOpen(false, null), false);
  assert.equal(resolveFoldOpen(false, true), true);
  assert.equal(resolveFoldOpen(true, false), false);
  assert.equal(workGroupLabel("explore", [{ name: "neo_browse", status: "running" }]), "正在浏览…");
  assert.equal(workGroupLabel("explore", [{ name: "neo_browse" }, { name: "neo_browse" }]), "浏览 2 个页面");
  assert.equal(previewWorkTools(Array.from({ length: 10 }, (_, i) => i)).hidden, 2);
  assert.deepEqual(previewWorkTools([1, 2, 3]).shown, [1, 2, 3]);
});

test("write file card previews twelve lines and counts the rest", () => {
  const content = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  const tool = { name: "write", args: { path: "brief.md", content } };
  assert.equal(toolChromeKind("write"), "file");
  assert.equal(toolChromeKind("bash"), "term");
  assert.equal(toolChromeKind("neo_browse"), "link");
  assert.equal(toolChromeKind("grep"), "link");
  assert.equal(toolChromeKind("read"), "default");
  assert.deepEqual(toolDiffStat(tool), { added: 20, removed: 0 });
  const card = fileCardPreview(tool);
  assert.equal(card?.path, "brief.md");
  assert.equal(card?.lines.length, 12);
  assert.equal(card?.hidden, 8);
  assert.equal(card?.lines[0]?.text, "line 0");
  const full = fileCardPreview(tool, { full: true });
  assert.equal(full?.lines.length, 20);
  assert.equal(full?.hidden, 0);
  assert.equal(full?.lines[19]?.text, "line 19");
  assert.equal(toolLinkLabel({ name: "neo_browse", args: { url: "https://example.com" } }), "https://example.com");
  assert.equal(
    toolLinkLabel({ name: "neo_browse", args: {}, details: { title: "Example Domain", url: "https://example.com" } }),
    "Example Domain",
  );
  assert.equal(toolLinkLabel({ name: "grep", args: { pattern: "TODO" } }), "TODO");
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
