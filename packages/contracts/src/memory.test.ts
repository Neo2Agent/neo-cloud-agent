import assert from "node:assert/strict";
import test from "node:test";
import {
  filterMemories,
  MEMORY_LIST_LIMIT_DEFAULT,
  MEMORY_LIST_LIMIT_MAX,
  MEMORY_SEARCH_LIMIT_DEFAULT,
  MEMORY_SEARCH_LIMIT_MAX,
  MEMORY_TEXT_MAX_LENGTH,
  memoryEdited,
  memoryErrorMessage,
  memoryHint,
  readMemoryError,
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
