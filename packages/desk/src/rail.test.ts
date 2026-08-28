import assert from "node:assert/strict";
import test from "node:test";
import { groupRailSessions, isLocalPath, lastPathSegment, railPlacement } from "./rail.js";

test("empty repo and no project stay in 对话", () => {
  assert.deepEqual(railPlacement({ id: "1", repoUrls: [] }), { section: "inbox" });
  assert.deepEqual(railPlacement({ id: "2", repoUrls: [""] }), { section: "inbox" });
  assert.deepEqual(railPlacement({ id: "3" }), { section: "inbox" });
});

test("project wins over repo and goes to 空间", () => {
  assert.deepEqual(railPlacement({ id: "1", projectId: "proj_1", repoUrls: ["https://github.com/acme/toy"] }, "Desk 工作台"), {
    section: "space",
    kind: "project",
    key: "project:proj_1",
    label: "Desk 工作台",
    projectId: "proj_1",
  });
});

test("local directory and git remote become 空间 folders", () => {
  assert.equal(isLocalPath("/workspace/app"), true);
  assert.equal(isLocalPath("C:\\src\\app"), true);
  assert.equal(isLocalPath("https://github.com/acme/toy.git"), false);
  assert.deepEqual(railPlacement({ id: "1", repoUrls: ["/tmp/demo"] }), {
    section: "space",
    kind: "folder",
    key: "folder:/tmp/demo",
    label: "demo",
  });
  assert.equal(railPlacement({ id: "2", repoUrls: ["https://github.com/acme/toy.git"] }).section, "space");
  assert.equal(lastPathSegment("https://github.com/acme/toy.git"), "toy");
  assert.equal(lastPathSegment("fixtures/toy-repo"), "toy-repo");
});

test("groupRailSessions splits inbox from nested spaces", () => {
  const grouped = groupRailSessions(
    [
      { id: "a", repoUrls: [], updatedAt: "2026-08-25T02:00:00.000Z" },
      { id: "b", projectId: "p1", repoUrls: ["https://github.com/acme/toy"], updatedAt: "2026-08-25T03:00:00.000Z" },
      { id: "c", projectId: "p1", updatedAt: "2026-08-25T01:00:00.000Z" },
      { id: "d", repoUrls: ["/home/me/app"], updatedAt: "2026-08-25T04:00:00.000Z" },
    ],
    (id) => (id === "p1" ? "工作台" : undefined),
  );
  assert.deepEqual(grouped.inbox.map((item) => item.id), ["a"]);
  assert.deepEqual(grouped.spaces.map((item) => item.key), ["folder:/home/me/app", "project:p1"]);
  assert.deepEqual(grouped.spaces[1]?.runs.map((item) => item.id), ["b", "c"]);
  assert.equal(grouped.spaces[1]?.label, "工作台");
});
