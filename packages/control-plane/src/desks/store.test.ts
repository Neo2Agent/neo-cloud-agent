import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-desks-"));

const {
  createDesk,
  findDeskByToken,
  isDeskOnline,
  listDesks,
  offerDeskAssignment,
  resetDeskAssignmentsForTests,
  takeDeskAssignment,
  waitDeskAssignment,
} = await import("./store.js");

test("createDesk returns a token that can be looked up", () => {
  const created = createDesk({ name: "Ada’s laptop", hostname: "ada", platform: "darwin" }, {
    userId: "user_ada",
    orgId: "org_local",
  });
  assert.equal(created.desk.name, "Ada’s laptop");
  assert.match(created.token, /^desk_/);
  assert.equal(findDeskByToken(created.token)?.id, created.desk.id);
  assert.equal(findDeskByToken("desk_nope"), undefined);
  assert.equal(listDesks("user_ada").some((item) => item.id === created.desk.id), true);
  assert.equal(isDeskOnline(created.desk), true);
});

test("waitDeskAssignment resolves when a run is offered", async () => {
  resetDeskAssignmentsForTests();
  const created = createDesk({ hostname: "box" }, { userId: "user_ada", orgId: "org_local" });
  const pending = waitDeskAssignment(created.desk.id, 2_000);
  offerDeskAssignment(created.desk.id, "run-1");
  assert.equal(await pending, "run-1");
  assert.equal(takeDeskAssignment(created.desk.id), null);
});
