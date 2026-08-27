import assert from "node:assert/strict";
import test from "node:test";
import { deskRepoKey, deskWorkspaceShortName } from "./desk-workspace.js";

test("short name is the last path segment on either separator", () => {
  assert.equal(deskWorkspaceShortName("/home/me/code/app"), "app");
  assert.equal(deskWorkspaceShortName("/home/me/code/app/"), "app");
  assert.equal(deskWorkspaceShortName("C:\\work\\app"), "app");
  assert.equal(deskWorkspaceShortName(""), "");
});

test("the same repo gives the same key from any remote spelling", () => {
  const expected = "github.com/acme/app";
  assert.equal(deskRepoKey({ remoteUrl: "https://github.com/acme/app.git" }), expected);
  assert.equal(deskRepoKey({ remoteUrl: "https://github.com/Acme/App" }), expected);
  assert.equal(deskRepoKey({ remoteUrl: "git@github.com:acme/app.git" }), expected);
  assert.equal(deskRepoKey({ remoteUrl: "ssh://git@github.com/acme/app" }), expected);
});

test("a folder with no remote falls back to its own name", () => {
  assert.equal(deskRepoKey({ folder: "/home/me/Scratch" }), "local:scratch");
  assert.equal(deskRepoKey({ remoteUrl: "", folder: "/home/me/scratch" }), "local:scratch");
  assert.equal(deskRepoKey({}), "");
});

test("different repos never collide", () => {
  assert.notEqual(
    deskRepoKey({ remoteUrl: "https://github.com/acme/app" }),
    deskRepoKey({ remoteUrl: "https://github.com/acme/other" }),
  );
});
