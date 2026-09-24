import assert from "node:assert/strict";
import test from "node:test";
import { cloudSafeRepoUrls, isLocalFolderRef, normalizeRepoUrl, repoShortLabel } from "./repo.js";

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

test("normalizeRepoUrl accepts owner/repo and host paths", () => {
  assert.equal(normalizeRepoUrl("acme/app"), "https://github.com/acme/app.git");
  assert.equal(normalizeRepoUrl("github.com/acme/app"), "https://github.com/acme/app.git");
  assert.equal(normalizeRepoUrl("https://github.com/acme/app.git"), "https://github.com/acme/app.git");
  assert.equal(normalizeRepoUrl("  "), "");
});

test("repoShortLabel keeps owner/name", () => {
  assert.equal(repoShortLabel("https://github.com/acme/app.git"), "acme/app");
  assert.equal(repoShortLabel("acme/app"), "acme/app");
});
