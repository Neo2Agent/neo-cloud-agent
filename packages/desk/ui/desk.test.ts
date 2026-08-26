import assert from "node:assert/strict";
import test from "node:test";
import { asWorkspaceRef } from "./desk.ts";

test("asWorkspaceRef accepts a path string from an older preload", () => {
  const picked = asWorkspaceRef("/tmp/desk-local-verify");
  assert.deepEqual(picked, {
    id: "",
    folder: "/tmp/desk-local-verify",
    name: "desk-local-verify",
    git: false,
  });
});

test("asWorkspaceRef maps workspaceId onto id", () => {
  const picked = asWorkspaceRef({
    workspaceId: "dws_1",
    folder: "/tmp/desk-local-verify",
    name: "desk-local-verify",
    git: true,
  });
  assert.equal(picked?.id, "dws_1");
  assert.equal(picked?.folder, "/tmp/desk-local-verify");
});
