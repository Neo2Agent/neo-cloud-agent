import assert from "node:assert/strict";
import test from "node:test";
import { filterRuns, groupRuns, groupRunsByProject, readPinnedRuns, splitShelvedRuns, togglePinnedRun } from "./pins.js";

function memoryStorage(start: Record<string, string> = {}) {
  const data = { ...start };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

test("togglePinnedRun adds then removes", () => {
  const storage = memoryStorage();
  assert.deepEqual(togglePinnedRun("a", storage), ["a"]);
  assert.deepEqual(readPinnedRuns(storage), ["a"]);
  assert.deepEqual(togglePinnedRun("a", storage), []);
});

test("groupRuns splits pinned, active, and recent", () => {
  const runs = [
    { id: "1", status: "RUNNING", createdAt: "2026-08-23T10:00:00.000Z" },
    { id: "2", status: "IDLE", createdAt: "2026-08-23T11:00:00.000Z" },
    { id: "3", status: "IDLE", createdAt: "2026-08-23T09:00:00.000Z" },
  ];
  const grouped = groupRuns(runs, ["3"]);
  assert.deepEqual(grouped.pinned.map((item) => item.id), ["3"]);
  assert.deepEqual(grouped.active.map((item) => item.id), ["1"]);
  assert.deepEqual(grouped.recent.map((item) => item.id), ["2"]);
});

test("groupRunsByProject keeps unassigned runs separate", () => {
  const runs = [
    { id: "1", status: "RUNNING", createdAt: "2026-08-23T10:00:00.000Z", projectId: "p1" },
    { id: "2", status: "IDLE", createdAt: "2026-08-23T11:00:00.000Z" },
  ];
  const grouped = groupRunsByProject(runs, [], { p1: "官网" });
  assert.equal(grouped.sections[0]?.label, "官网");
  assert.equal(grouped.sections[1]?.label, "未归项目");
  assert.deepEqual(filterRuns(runs, "官网"), []);
  assert.equal(filterRuns([{ id: "1", prompt: "修官网登录" }], "登录")[0]?.id, "1");
  assert.equal(filterRuns([{ id: "2", prompt: "后面还有", title: "分析会话存储" }], "会话")[0]?.id, "2");
});

test("splitShelvedRuns keeps archived and expired out of the live list", () => {
  const split = splitShelvedRuns([
    { id: "1", status: "IDLE" },
    { id: "2", status: "ARCHIVED" },
    { id: "3", status: "EXPIRED" },
    { id: "4", status: "RUNNING" },
  ]);
  assert.deepEqual(
    split.live.map((item) => item.id),
    ["1", "4"],
  );
  assert.deepEqual(
    split.shelved.map((item) => item.id),
    ["2", "3"],
  );
});
