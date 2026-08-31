import assert from "node:assert/strict";
import test from "node:test";
import { filterMemories, memoryHint } from "./memory.js";

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
  assert.equal(memoryHint({ configured: true, count: 1, error: "记忆服务不可用" }), "记忆服务不可用");
});
