import assert from "node:assert/strict";
import test from "node:test";
import {
  avatarTone,
  CATALOG_PAGE_SIZE,
  clampPage,
  filterByQuery,
  initials,
  pageCount,
  paginate,
  snippet,
} from "./catalog.js";

test("filterByQuery is case-insensitive and ignores empty query", () => {
  const items = [
    { name: "官网改版", instruction: "用中文回复" },
    { name: "发布检查", instruction: "跑测试" },
  ];
  assert.deepEqual(filterByQuery(items, "", (item) => [item.name]), items);
  assert.equal(filterByQuery(items, "官网", (item) => [item.name, item.instruction]).length, 1);
  assert.equal(filterByQuery(items, "测试", (item) => [item.name, item.instruction])[0]?.name, "发布检查");
});

test("paginate and pageCount use a 12-item catalog page", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);
  assert.equal(CATALOG_PAGE_SIZE, 12);
  assert.equal(pageCount(items.length), 3);
  assert.deepEqual(paginate(items, 1), items.slice(0, 12));
  assert.deepEqual(paginate(items, 3), [25]);
  assert.equal(clampPage(9, items.length), 3);
  assert.equal(clampPage(0, 0), 1);
});

test("initials and snippet keep catalog cards short", () => {
  assert.equal(initials("官网改版"), "官");
  assert.equal(initials("  "), "?");
  assert.equal(snippet("用中文回复，改代码先跑测试", 8), "用中文回复，改代…");
  assert.equal(snippet("  short  "), "short");
  assert.ok(avatarTone("官网") >= 0 && avatarTone("官网") < 5);
});
