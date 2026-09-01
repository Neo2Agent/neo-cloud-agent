import assert from "node:assert/strict";
import test from "node:test";
import { artifactKind, artifactKindLabel, artifactUploadName, blobForPreview, previewKind, prettyBytes } from "./artifact.js";
import { parseProjectHash, projectHashHref } from "./project-route.js";

test("previewKind maps html and images, ignores text", () => {
  assert.equal(previewKind({ name: "board.html" }), "html");
  assert.equal(previewKind({ name: "notes.txt", contentType: "text/html" }), "html");
  assert.equal(previewKind({ name: "shot.PNG" }), "image");
  assert.equal(previewKind({ name: "cover", contentType: "image/webp" }), "image");
  assert.equal(previewKind({ name: "notes.txt", contentType: "text/plain" }), null);
});

test("artifactKind maps names and types to a short kind", () => {
  assert.equal(artifactKind({ name: "board.html" }), "html");
  assert.equal(artifactKind({ name: "shot.png" }), "image");
  assert.equal(artifactKind({ name: "notes.txt", contentType: "text/plain" }), "text");
  assert.equal(artifactKind({ name: "data.bin" }), "file");
});

test("artifactKindLabel prefers a short badge over the raw type", () => {
  assert.equal(artifactKindLabel({ name: "board.html" }), "HTML");
  assert.equal(artifactKindLabel({ name: "shot.png" }), "图片");
  assert.equal(artifactKindLabel({ name: "notes.txt", contentType: "text/plain" }), "文本");
  assert.equal(artifactKindLabel({ name: "data.bin" }), "文件");
});

test("artifactUploadName prefers name then href then title", () => {
  assert.equal(artifactUploadName({ name: "board.html" }), "board.html");
  assert.equal(artifactUploadName({ href: "/v1/runs/r/artifacts/shot.png?token=x" }), "shot.png");
  assert.equal(artifactUploadName({ text: "已上传 notes.txt" }), "notes.txt");
});

test("blobForPreview stamps utf-8 on html without a charset", () => {
  const raw = new Blob(["<h1>预览</h1>"], { type: "text/html" });
  assert.equal(blobForPreview(raw, { name: "board.html" }).type, "text/html; charset=utf-8");
  const image = new Blob([new Uint8Array([1])], { type: "image/png" });
  assert.equal(blobForPreview(image, { name: "dot.png" }).type, "image/png");
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
