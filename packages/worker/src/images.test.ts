import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inboundPrompt, materializeInboundImages, toPiImageContent } from "./images.js";

test("writes pasted images into the workspace inbox", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-img-"));
  const attached = materializeInboundImages(cwd, [
    { mediaType: "image/png", data: Buffer.from("hello").toString("base64") },
  ]);
  assert.equal(attached.files[0], ".neo/inbox-images/paste-1.png");
  assert.equal(readFileSync(path.join(cwd, attached.files[0] ?? ""), "utf8"), "hello");
  assert.match(attached.note, /paste-1.png/);
});

test("toPiImageContent maps ImageRef to pi vision parts", () => {
  const images = toPiImageContent([
    { mediaType: "image/png", data: `data:image/png;base64,${Buffer.from("hello").toString("base64")}` },
  ]);
  assert.equal(images[0]?.type, "image");
  assert.equal(images[0]?.mimeType, "image/png");
  assert.equal(images[0]?.data, Buffer.from("hello").toString("base64"));
});

test("inboundPrompt keeps a vision note and image parts", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-img-prompt-"));
  const prompt = inboundPrompt(cwd, {
    type: "prompt",
    text: "what is this",
    images: [{ mediaType: "image/jpeg", data: Buffer.from("jpeg").toString("base64") }],
  });
  assert.match(prompt.text, /vision input/);
  assert.match(prompt.text, /paste-1.jpg/);
  assert.equal(prompt.images.length, 1);
  assert.equal(prompt.images[0]?.mimeType, "image/jpeg");
});
