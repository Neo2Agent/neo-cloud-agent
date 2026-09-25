import assert from "node:assert/strict";
import test from "node:test";
import {
  filterRuns,
  groupRuns,
  groupRunsByProject,
  groupSidebarRuns,
  readPinnedRuns,
  runKindLabel,
  runRepoKey,
  splitShelvedRuns,
  togglePinnedRun,
} from "./pins.js";

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

test("groupRunsByProject keeps unassigned runs out of folders", () => {
  const runs = [
    { id: "1", status: "RUNNING", createdAt: "2026-08-23T10:00:00.000Z", projectId: "p1" },
    { id: "2", status: "IDLE", createdAt: "2026-08-23T11:00:00.000Z" },
  ];
  const grouped = groupRunsByProject(runs, [], { p1: "官网" });
  assert.equal(grouped.folders[0]?.label, "官网");
  assert.deepEqual(grouped.folders[0]?.active.map((item) => item.id), ["1"]);
  assert.deepEqual(grouped.loose.recent.map((item) => item.id), ["2"]);
  assert.equal(grouped.folders.some((item) => item.key === "none"), false);
  assert.deepEqual(filterRuns(runs, "官网"), []);
  assert.equal(filterRuns([{ id: "1", prompt: "修官网登录" }], "登录")[0]?.id, "1");
});

test("groupSidebarRuns splits projects, repos, and everyday chats", () => {
  const runs = [
    {
      id: "proj-code",
      status: "IDLE",
      createdAt: "2026-08-23T10:00:00.000Z",
      projectId: "p1",
      repoUrls: ["https://github.com/acme/app.git"],
    },
    {
      id: "loose-a",
      status: "IDLE",
      createdAt: "2026-08-23T11:00:00.000Z",
      repoUrls: ["https://github.com/Acme/App"],
    },
    {
      id: "loose-b",
      status: "RUNNING",
      createdAt: "2026-08-23T12:00:00.000Z",
      repoUrls: ["https://github.com/acme/app.git"],
    },
    { id: "chat", status: "IDLE", createdAt: "2026-08-23T13:00:00.000Z" },
  ];
  const grouped = groupSidebarRuns(runs, ["chat"], { p1: "官网" });
  assert.deepEqual(grouped.pinned.map((item) => item.id), ["chat"]);
  assert.equal(grouped.folders[0]?.label, "官网");
  assert.deepEqual(grouped.folders[0]?.recent.map((item) => item.id), ["proj-code"]);
  assert.equal(grouped.repos.length, 1);
  assert.equal(grouped.repos[0]?.label, "acme/app");
  assert.deepEqual(
    [...grouped.repos[0]!.active, ...grouped.repos[0]!.recent].map((item) => item.id).sort(),
    ["loose-a", "loose-b"],
  );
  assert.deepEqual(grouped.chat.recent.map((item) => item.id), []);
  assert.equal(runRepoKey({ repoUrls: ["https://github.com/acme/app.git"] }), "github.com/acme/app");
  assert.equal(filterRuns(runs, "acme/app").some((item) => item.id === "loose-a"), true);
});

test("runKindLabel marks project chats as office or code", () => {
  assert.equal(runKindLabel({ projectId: "p1", repoUrls: [] }), "办公");
  assert.equal(runKindLabel({ projectId: "p1", repoUrls: ["https://github.com/acme/app.git"] }), "代码");
  assert.equal(runKindLabel({ repoUrls: ["https://github.com/acme/app.git"] }), null);
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
