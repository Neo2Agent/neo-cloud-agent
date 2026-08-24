import assert from "node:assert/strict";
import test from "node:test";
import { groupRuns, readPinnedRuns, togglePinnedRun } from "./pins.js";

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
