import assert from "node:assert/strict";
import test from "node:test";
import { cloudSafeRepoUrls, isLocalFolderRef } from "./repo.js";

test("isLocalFolderRef accepts host paths and file URLs", () => {
  assert.equal(isLocalFolderRef("/tmp/desk-local-verify"), true);
  assert.equal(isLocalFolderRef("file:///Users/me/app"), true);
  assert.equal(isLocalFolderRef("C:\\src\\app"), true);
  assert.equal(isLocalFolderRef("https://github.com/acme/app.git"), false);
  assert.equal(isLocalFolderRef("github.com/acme/app"), false);
});

test("cloudSafeRepoUrls drops local folders and keeps remotes", () => {
  assert.deepEqual(cloudSafeRepoUrls(["/tmp/desk-local-verify", "https://github.com/acme/app.git", ""]), [
    "https://github.com/acme/app.git",
  ]);
});
