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
  defaultUserTab,
  filterExpertsByTab,
  filterRunsByTab,
  filterUsersByTab,
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

test("type tabs scope users, runs, and experts", () => {
  const users = [{ status: "pending" as const }, { status: "active" as const }, { status: "disabled" as const }];
  assert.equal(filterUsersByTab(users, "pending").length, 1);
  assert.equal(filterUsersByTab(users, "active").length, 1);
  assert.equal(filterUsersByTab(users, "all").length, 3);
  assert.equal(defaultUserTab(users), "pending");
  assert.equal(defaultUserTab([{ status: "active" }]), "all");

  const runs = [
    { status: "RUNNING" },
    { status: "IDLE" },
    { status: "ERROR" },
    { status: "ARCHIVED" },
  ];
  assert.equal(filterRunsByTab(runs, "live").length, 1);
  assert.equal(filterRunsByTab(runs, "idle")[0]?.status, "IDLE");
  assert.equal(filterRunsByTab(runs, "error").length, 1);
  assert.equal(filterRunsByTab(runs, "archived").length, 1);

  const experts = [{ enabled: true }, { enabled: false }];
  assert.equal(filterExpertsByTab(experts, "enabled").length, 1);
  assert.equal(filterExpertsByTab(experts, "disabled").length, 1);
});
