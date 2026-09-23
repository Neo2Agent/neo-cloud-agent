import assert from "node:assert/strict";
import test from "node:test";
import {
  fileCardPreview,
  fileToolDiff,
  formatDuration,
  formatMessageTime,
  formatRunTime,
  formatUsage,
  formatListWhen,
  formatWhen,
  modelLabel,
  nextChatModel,
  parseUnifiedDiff,
  resolveChatModel,
  runListPlaceSuffix,
  toolArgPreview,
  toolChromeKind,
  toolDiffStat,
  toolLinkLabel,
  partitionTurn,
  previewWorkTools,
  resolveFoldOpen,
  slotMenuLines,
  toolGroupSummary,
  toolVerb,
  workGroupLabel,
} from "./format.js";

test("runListPlaceSuffix labels Remote separately from This Computer", () => {
  assert.equal(
    runListPlaceSuffix({
      executionTarget: { loop: "cloud", tools: "desk", deskId: "desk_1", remoteControl: true },
    }),
    " · Remote",
  );
  assert.equal(runListPlaceSuffix({ executionTarget: { loop: "desk", tools: "desk", deskId: "desk_1" } }), " · 本机");
  assert.equal(
    runListPlaceSuffix({
      executionTarget: { loop: "desk", tools: "desk", deskId: "desk_1", remoteControl: true },
    }),
    " · 本机",
  );
  assert.equal(runListPlaceSuffix({ executionTarget: { loop: "cloud", tools: "cloud" }, vmSlotId: "slot-0" }), " · VM 1");
});

test("modelLabel and resolveChatModel pin DeepSeek to Flash 4.1", () => {
  assert.equal(modelLabel("deepseek", "deepseek-flash"), "DeepSeek Flash 4.1");
  assert.equal(modelLabel("deepseek", "deepseek-v4-pro"), "DeepSeek Flash 4.1");
  assert.equal(modelLabel("deepseek", "deepseek-v4-flash-vision-exp"), "DeepSeek Flash 4.1");
  assert.equal(modelLabel("deepseek", "step-5-preview"), "Step 5 Preview");
  assert.equal(resolveChatModel("deepseek", "deepseek-v4-flash"), "deepseek-flash");
  assert.equal(resolveChatModel("deepseek", "deepseek-v4-flash", true), "deepseek-flash");
  assert.equal(resolveChatModel("deepseek", "deepseek-v4-pro"), "deepseek-flash");
  assert.equal(resolveChatModel("deepseek", "neo/step"), "step-5-preview");
  assert.equal(resolveChatModel("mock", null), "deepseek-flash");
  assert.equal(resolveChatModel("mock", "mock"), "deepseek-flash");
  assert.equal(nextChatModel("deepseek-flash"), "step-5-preview");
  assert.equal(nextChatModel("step-5-preview"), "deepseek-flash");
});

test("formatUsage prints total tokens", () => {
  assert.equal(formatUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }), "15 tok");
});

test("formatListWhen uses minutes, then hours, then days", () => {
  const now = new Date("2026-08-24T10:00:00.000Z");
  assert.equal(formatListWhen("2026-08-24T09:59:30.000Z", now), "刚刚");
  assert.equal(formatListWhen("2026-08-24T09:55:00.000Z", now), "5分钟");
  assert.equal(formatListWhen("2026-08-24T08:00:00.000Z", now), "2小时");
  assert.equal(formatListWhen("2026-08-23T10:00:00.000Z", now), "1天");
  assert.equal(formatListWhen("2026-08-21T10:00:00.000Z", now), "3天");
});

test("formatWhen uses Shanghai time and drops the current year", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  assert.equal(formatWhen("2026-08-24T09:30:00.000Z", now), "8/24 17:30");
  assert.match(formatWhen("2025-06-01T00:00:00.000Z", now), /2025/);
});

test("formatRunTime and formatMessageTime show update only when the minute changes", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  assert.equal(formatRunTime("2026-08-24T09:30:00.000Z", "2026-08-24T09:30:40.000Z", now), "8/24 17:30");
  assert.equal(
    formatRunTime("2026-08-24T09:30:00.000Z", "2026-08-24T10:05:00.000Z", now),
    "创建 8/24 17:30 · 更新 8/24 18:05",
  );
  assert.equal(formatMessageTime("2026-08-24T09:30:00.000Z", "2026-08-24T10:05:00.000Z", true, now), "8/24 17:30");
  assert.equal(
    formatMessageTime("2026-08-24T09:30:00.000Z", "2026-08-24T10:05:00.000Z", false, now),
    "8/24 17:30 · 完成 8/24 18:05",
  );
});

test("formatDuration prints seconds then minutes", () => {
  assert.equal(formatDuration("2026-08-24T09:30:00.000Z", "2026-08-24T09:30:12.000Z"), "12s");
  assert.equal(formatDuration("2026-08-24T09:30:00.000Z", "2026-08-24T09:33:00.000Z"), "3m");
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

test("slotMenuLines names idle slots once and busy slots by the conversation", () => {
  const lines = slotMenuLines(
    [
      { id: "slot-0", status: "idle", runId: null },
      { id: "slot-1", status: "busy", runId: "run-2" },
    ],
    [{ id: "run-2", prompt: "给我调研最新ai资讯", vmSlotId: "slot-1" }],
  );
  assert.equal(lines[0]?.label, "VM 1 · 空闲");
  assert.equal(lines[0]?.runId, null);
  assert.match(lines[1]?.label ?? "", /^VM 2 · /);
  assert.equal(lines[1]?.runId, "run-2");
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
