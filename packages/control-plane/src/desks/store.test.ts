import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-desks-"));

const {
  bindDeskWorkspace,
  createDesk,
  dropDeskAssignment,
  findDeskByToken,
  findDeskWorkspace,
  getDesk,
  isDeskOnline,
  listDesks,
  offerDeskAssignment,
  openDeskInbox,
  pushDeskInbox,
  resetDeskAssignmentsForTests,
  takeDeskAssignment,
  unbindDeskWorkspace,
  updateDesk,
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
  assert.equal(created.desk.allowRemote, true);
});

test("a desk is only reachable while it holds an inbox stream", () => {
  const created = createDesk({ hostname: "ada-2" }, { userId: "user_ada", orgId: "org_local" });
  // Registering is not a heartbeat: nothing is listening yet.
  assert.equal(isDeskOnline(created.desk), false);
  const seen: string[] = [];
  const detach = openDeskInbox(created.desk.id, (event) => seen.push(event.kind));
  assert.equal(isDeskOnline(created.desk), true);
  assert.equal(getDesk(created.desk.id)?.online, true);
  assert.equal(pushDeskInbox(created.desk.id, { kind: "ping" }), true);
  assert.deepEqual(seen, ["ping"]);
  detach();
  assert.equal(isDeskOnline(created.desk), false);
  assert.equal(pushDeskInbox(created.desk.id, { kind: "ping" }), false);
});

test("binding a folder is idempotent per repo and can be undone", () => {
  const created = createDesk({ hostname: "ada-3" }, { userId: "user_ada", orgId: "org_local" });
  const first = bindDeskWorkspace(created.desk.id, { name: "app", repoKey: "github.com/acme/app", git: true });
  const again = bindDeskWorkspace(created.desk.id, { name: "app-renamed", repoKey: "github.com/acme/app", git: true });
  assert.equal(again.id, first.id);
  assert.equal(again.name, "app-renamed");
  const desk = getDesk(created.desk.id);
  assert.equal(desk?.workspaces?.length, 1);
  assert.equal(findDeskWorkspace(desk!, { repoKey: "github.com/acme/app" })?.id, first.id);
  assert.equal(findDeskWorkspace(desk!, { repoKey: "github.com/acme/other" }), undefined);
  assert.equal(unbindDeskWorkspace(created.desk.id, first.id), true);
  assert.equal(unbindDeskWorkspace(created.desk.id, first.id), false);
  assert.equal(getDesk(created.desk.id)?.workspaces?.length, 0);
});

test("the remote switch is stored on the desk", () => {
  const created = createDesk({ hostname: "ada-4" }, { userId: "user_ada", orgId: "org_local" });
  assert.equal(updateDesk(created.desk.id, { allowRemote: false })?.allowRemote, false);
  assert.equal(getDesk(created.desk.id)?.allowRemote, false);
  assert.equal(updateDesk("desk_missing", { allowRemote: true }), undefined);
});

test("waitDeskAssignment resolves when a run is offered", async () => {
  resetDeskAssignmentsForTests();
  const created = createDesk({ hostname: "box" }, { userId: "user_ada", orgId: "org_local" });
  const pending = waitDeskAssignment(created.desk.id, 2_000);
  offerDeskAssignment(created.desk.id, "run-1");
  assert.equal(await pending, "run-1");
  assert.equal(takeDeskAssignment(created.desk.id), null);
});

test("a dropped offer is not handed out later", () => {
  resetDeskAssignmentsForTests();
  const created = createDesk({ hostname: "box-drop" }, { userId: "user_ada", orgId: "org_local" });
  offerDeskAssignment(created.desk.id, "run-drop");
  dropDeskAssignment(created.desk.id, "run-drop");
  assert.equal(takeDeskAssignment(created.desk.id), null);
});
