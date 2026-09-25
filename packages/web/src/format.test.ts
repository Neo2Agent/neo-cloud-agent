import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDuration,
  formatMessageTime,
  formatRunTime,
  formatUsage,
  formatListWhen,
  formatSidebarAge,
  formatWhen,
  modelLabel,
  nextChatModel,
  resolveChatModel,
  runListPlaceSuffix,
  toolArgPreview,
  slotMenuLines,
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

test("formatSidebarAge uses Cursor's short m/h/d rest labels", () => {
  const now = new Date("2026-08-24T10:00:00.000Z");
  assert.equal(formatSidebarAge("2026-08-24T09:59:30.000Z", now), "");
  assert.equal(formatSidebarAge("2026-08-24T09:55:00.000Z", now), "5m");
  assert.equal(formatSidebarAge("2026-08-24T06:00:00.000Z", now), "4h");
  assert.equal(formatSidebarAge("2026-07-05T10:00:00.000Z", now), "50d");
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
  assert.equal(formatMessageTime("2026-08-24T09:30:00.000Z", "2026-08-24T09:30:40.000Z", now), "8/24 17:30");
  assert.equal(
    formatMessageTime("2026-08-24T09:30:00.000Z", "2026-08-24T10:05:00.000Z", now),
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

