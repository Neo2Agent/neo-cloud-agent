import assert from "node:assert/strict";
import test from "node:test";
import { artifactKindLabel, previewKind, prettyBytes } from "./artifact.js";
import { parseProjectHash, projectHashHref } from "./project-route.js";

test("previewKind maps html and images, ignores text", () => {
  assert.equal(previewKind({ name: "board.html" }), "html");
  assert.equal(previewKind({ name: "notes.txt", contentType: "text/html" }), "html");
  assert.equal(previewKind({ name: "shot.PNG" }), "image");
  assert.equal(previewKind({ name: "cover", contentType: "image/webp" }), "image");
  assert.equal(previewKind({ name: "notes.txt", contentType: "text/plain" }), null);
});

test("artifactKindLabel prefers a short badge over the raw type", () => {
  assert.equal(artifactKindLabel({ name: "board.html" }), "HTML");
  assert.equal(artifactKindLabel({ name: "shot.png" }), "图片");
  assert.equal(artifactKindLabel({ name: "notes.txt", contentType: "text/plain" }), "文本");
  assert.equal(artifactKindLabel({ name: "data.bin" }), "文件");
});

test("prettyBytes uses the next unit past 1024", () => {
  assert.equal(prettyBytes(800), "800 B");
  assert.equal(prettyBytes(1536), "1.5 KB");
  assert.equal(prettyBytes(2 * 1024 * 1024), "2.0 MB");
});

test("parseProjectHash reads assets tab and highlight id", () => {
  assert.deepEqual(parseProjectHash("#/projects"), { projectId: null, assets: false, assetId: null });
  assert.deepEqual(parseProjectHash("#/projects/proj_1"), {
    projectId: "proj_1",
    assets: false,
    assetId: null,
  });
  assert.deepEqual(parseProjectHash("#/projects/proj_1/assets"), {
    projectId: "proj_1",
    assets: true,
    assetId: null,
  });
  assert.deepEqual(parseProjectHash("#/projects/proj_1/assets/asset_9"), {
    projectId: "proj_1",
    assets: true,
    assetId: "asset_9",
  });
  assert.deepEqual(parseProjectHash("#/experts/x"), { projectId: null, assets: false, assetId: null });
});

test("projectHashHref writes the assets deep link", () => {
  assert.equal(projectHashHref(), "/#/projects");
  assert.equal(projectHashHref("proj_1"), "/#/projects/proj_1");
  assert.equal(projectHashHref("proj_1", { assets: true }), "/#/projects/proj_1/assets");
  assert.equal(projectHashHref("proj_1", { assetId: "asset_9" }), "/#/projects/proj_1/assets/asset_9");
});
