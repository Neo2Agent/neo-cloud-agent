import assert from "node:assert/strict";
import test from "node:test";
import {
  appendUserMemory,
  appendUserRules,
  filterMemories,
  formatUserMemory,
  formatUserRules,
  MEMORY_INJECT_FILE_PREAMBLE,
  MEMORY_INJECT_SYSTEM_PREAMBLE,
  MEMORY_LIST_LIMIT_DEFAULT,
  MEMORY_LIST_LIMIT_MAX,
  MEMORY_SEARCH_LIMIT_DEFAULT,
  MEMORY_SEARCH_LIMIT_MAX,
  MEMORY_TEXT_MAX_LENGTH,
  memoryEdited,
  memoryErrorMessage,
  memoryHint,
  parseExtractedMemories,
  readMemoryError,
  rejectExtractedMemoryText,
  selectRecalledMemories,
  wrapPromptWithSessionMemory,
} from "./memory.js";

test("filterMemories matches text and skips empty queries", () => {
  const items = [
    { id: "m1", text: "偏好 pnpm" },
    { id: "m2", text: "用中文回复" },
  ];
  assert.equal(filterMemories(items, "").length, 2);
  assert.deepEqual(
    filterMemories(items, "pnpm").map((item) => item.id),
    ["m1"],
  );
});

test("memoryHint covers unconfigured empty and error", () => {
  assert.match(memoryHint({ configured: false, count: 0 }), /还没接上/);
  assert.match(memoryHint({ configured: true, count: 0 }), /记一条/);
  assert.match(memoryHint({ configured: true, count: 3 }), /已记住 3 条/);
  assert.match(memoryHint({ configured: true, count: 3 }), /改或删/);
  assert.equal(memoryHint({ configured: true, count: 1, error: "记忆服务不可用" }), "记忆服务不可用");
});

test("memoryEdited compares epoch, not strings", () => {
  assert.equal(memoryEdited({}), false);
  assert.equal(memoryEdited({ createdAt: "nope", updatedAt: "nope" }), false);
  assert.equal(
    memoryEdited({ createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }),
    false,
  );
  assert.equal(
    memoryEdited({ createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:01.000Z" }),
    true,
  );
});

test("memoryErrorMessage covers the public code table", () => {
  assert.equal(memoryErrorMessage("MEMORY_LOGIN_REQUIRED"), "请先登录");
  assert.equal(memoryErrorMessage("MEMORY_TEXT_REQUIRED"), "请填写记忆内容");
  assert.equal(memoryErrorMessage("MEMORY_TEXT_TOO_LONG"), "单条记忆不能超过 500 字");
  assert.equal(memoryErrorMessage("MEMORY_QUERY_REQUIRED"), "请填写要搜索的内容");
  assert.equal(memoryErrorMessage("MEMORY_NOT_FOUND"), "记忆不存在");
  assert.equal(memoryErrorMessage("MEMORY_VERSION_CONFLICT"), "这条记忆刚被改过，请刷新后再试");
  assert.equal(memoryErrorMessage("MEMORY_STORE_UNAVAILABLE"), "记忆还没接上");
  assert.equal(memoryErrorMessage("MEMORY_STORE_FAILED"), "记忆服务暂时不可用");
});

test("readMemoryError prefers message over error", () => {
  assert.equal(readMemoryError({ message: "记忆不存在", error: "MEMORY_NOT_FOUND" }), "记忆不存在");
  assert.equal(readMemoryError({ error: "记下失败" }), "记下失败");
  assert.equal(readMemoryError({}), "");
  assert.equal(readMemoryError(null), "");
});

test("limit and text constants match the sidecar values", () => {
  assert.equal(MEMORY_LIST_LIMIT_DEFAULT, 50);
  assert.equal(MEMORY_LIST_LIMIT_MAX, 100);
  assert.equal(MEMORY_SEARCH_LIMIT_DEFAULT, 8);
  assert.equal(MEMORY_SEARCH_LIMIT_MAX, 32);
  assert.equal(MEMORY_TEXT_MAX_LENGTH, 500);
});

test("inject copy is tendency not hard obedience", () => {
  const file = formatUserMemory([{ text: "倾向最小 diff" }]);
  const system = appendUserMemory("base", file);
  assert.match(file, /tendencies/);
  assert.match(file, /not veto power/);
  assert.match(file, /can be ignored/);
  assert.match(file, /PROJECT.md/);
  assert.match(system, /Tendencies from the user's memory store/);
  assert.match(system, /can be ignored/);
  assert.doesNotMatch(file, /Follow them unless/);
  assert.doesNotMatch(system, /Prefer them over guessing/);
  assert.equal(file.includes(MEMORY_INJECT_FILE_PREAMBLE), true);
  assert.equal(system.includes(MEMORY_INJECT_SYSTEM_PREAMBLE), true);
});

test("user rules stay weaker than the current message and project files", () => {
  const file = formatUserRules("用中文回复");
  const system = appendUserRules("base", file);
  assert.match(file, /lose to the current user message/);
  assert.match(system, /PROJECT.md \/ AGENTS.md/);
});

test("selectRecalledMemories pins manual coding and caps soft kinds", () => {
  const selected = selectRecalledMemories({
    pinned: [
      {
        id: "p1",
        text: "通常用 pnpm",
        metadata: { source: "manual", kind: "coding" },
      },
    ],
    candidates: [
      { id: "p1", text: "通常用 pnpm", score: 0.9, metadata: { source: "manual", kind: "coding" } },
      { id: "s1", text: "倾向最小 diff", score: 0.8, metadata: { kind: "style" } },
      { id: "s2", text: "倾向 draft PR", score: 0.79, metadata: { kind: "style" } },
      { id: "s3", text: "倾向少改 contracts", score: 0.78, metadata: { kind: "style" } },
      { id: "h1", text: "先结论", score: 0.77, metadata: { kind: "habit" } },
      { id: "low", text: "低分", score: 0.1, metadata: { kind: "coding" } },
      { id: "c1", text: "不要 force push", score: 0.7, metadata: { kind: "coding" } },
    ],
  });
  assert.deepEqual(
    selected.pinned.map((item) => item.id),
    ["p1"],
  );
  assert.deepEqual(
    selected.relevant.map((item) => item.id),
    ["s1", "s2", "h1", "c1"],
  );
});

test("extract filter drops companion project lock phrases", () => {
  assert.equal(rejectExtractedMemoryText("通常用 pnpm"), null);
  assert.equal(rejectExtractedMemoryText("用户讨厌重构"), "lock_phrase");
  assert.equal(rejectExtractedMemoryText("家人住在北京"), "companion");
  assert.equal(rejectExtractedMemoryText("昨天定了 idle 槽写回"), "project_fact");
  const parsed = parseExtractedMemories(
    JSON.stringify([
      { text: "通常用 pnpm", kind: "coding" },
      { text: "先用中文", kind: "habit" },
      { text: "家人最近很累", kind: "habit" },
      { text: "idle 槽写回工作区", kind: "coding" },
    ]),
  );
  assert.deepEqual(
    parsed.map((item) => item.text),
    ["通常用 pnpm", "先用中文"],
  );
});

test("session memory wrap is a user prefix not a system rewrite", () => {
  const wrapped = wrapPromptWithSessionMemory("继续改", "# Session memory\n- 用 pnpm\n");
  assert.match(wrapped, /【本场已确认的事实】/);
  assert.match(wrapped, /- 用 pnpm/);
  assert.match(wrapped, /【用户继续】\n继续改/);
  assert.equal(wrapPromptWithSessionMemory("继续改", ""), "继续改");
});

test("memoryErrorMessage covers disabled and promote codes", () => {
  assert.equal(memoryErrorMessage("MEMORY_DISABLED"), "记忆已关闭，这条不会写入");
  assert.equal(memoryErrorMessage("MEMORY_PROJECT_REQUIRED"), "提升到项目需要指定当前项目");
});
