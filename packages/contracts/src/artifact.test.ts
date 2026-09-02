import assert from "node:assert/strict";
import test from "node:test";
import { artifactKind, artifactKindLabel, previewKind, prettyBytes } from "./artifact.js";

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

test("prettyBytes uses the next unit past 1024", () => {
  assert.equal(prettyBytes(800), "800 B");
  assert.equal(prettyBytes(1536), "1.5 KB");
  assert.equal(prettyBytes(2 * 1024 * 1024), "2.0 MB");
});
