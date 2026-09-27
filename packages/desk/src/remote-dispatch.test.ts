import assert from "node:assert/strict";
import test from "node:test";
import { dispatchedAssignmentDecision, matchBoundWorkspace } from "./remote-dispatch.js";

test("own follow-ups are accepted even when remote dispatch is off", () => {
  assert.equal(dispatchedAssignmentDecision({ allowRemote: false }), "own");
  assert.equal(dispatchedAssignmentDecision({ allowRemote: false, requestedBy: "", workspaceId: "" }), "own");
});

test("web or phone dispatch is rejected until the machine allows remote", () => {
  assert.equal(dispatchedAssignmentDecision({ allowRemote: false, requestedBy: "admin" }), "reject");
  assert.equal(dispatchedAssignmentDecision({ allowRemote: false, workspaceId: "dws_1" }), "reject");
  assert.equal(dispatchedAssignmentDecision({ allowRemote: true, requestedBy: "admin", workspaceId: "dws_1" }), "accept");
});

test("matchBoundWorkspace accepts either the local id or the published catalog id", () => {
  const items = [
    { id: "dws_local_aaa", remoteId: "dws_ffff", folder: "/proj/a" },
    { id: "dws_local_bbb", folder: "/proj/b" },
  ];
  assert.equal(matchBoundWorkspace(items, { workspaceId: "dws_local_aaa" })?.folder, "/proj/a");
  assert.equal(matchBoundWorkspace(items, { workspaceId: "dws_ffff" })?.folder, "/proj/a");
  assert.equal(matchBoundWorkspace(items, { folder: "/proj/b" })?.id, "dws_local_bbb");
  assert.equal(matchBoundWorkspace(items, { workspaceId: "missing" }), undefined);
});
