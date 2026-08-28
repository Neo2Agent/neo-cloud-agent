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

test("a per-run scratch keeps two runs from overwriting paste-1", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-img-scratch-"));
  const first = materializeInboundImages(
    cwd,
    [{ mediaType: "image/png", data: Buffer.from("first").toString("base64") }],
    path.join(cwd, ".neo", "runs", "run-a"),
  );
  const second = materializeInboundImages(
    cwd,
    [{ mediaType: "image/png", data: Buffer.from("second").toString("base64") }],
    path.join(cwd, ".neo", "runs", "run-b"),
  );
  assert.equal(first.files[0], ".neo/runs/run-a/inbox-images/paste-1.png");
  assert.equal(second.files[0], ".neo/runs/run-b/inbox-images/paste-1.png");
  // Both paths are relative to the workspace, which is what the agent can read.
  assert.equal(readFileSync(path.join(cwd, first.files[0] ?? ""), "utf8"), "first");
  assert.equal(readFileSync(path.join(cwd, second.files[0] ?? ""), "utf8"), "second");
});

test("a scratch dir outside the workspace is refused, not escaped into", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-img-outside-"));
  const outside = mkdtempSync(path.join(tmpdir(), "neo-img-elsewhere-"));
  const attached = materializeInboundImages(
    cwd,
    [{ mediaType: "image/png", data: Buffer.from("hello").toString("base64") }],
    outside,
  );
  // The agent gets workspace-relative paths and the sandbox stops at the root,
  // so an outside scratch has to fall back rather than produce an unreadable path.
  assert.equal(attached.files[0], ".neo/inbox-images/paste-1.png");
  assert.equal(readFileSync(path.join(cwd, attached.files[0] ?? ""), "utf8"), "hello");
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
