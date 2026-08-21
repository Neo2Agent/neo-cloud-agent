import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { materializeInboundImages } from "./images.js";

test("writes pasted images into the workspace inbox", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "neo-img-"));
  const attached = materializeInboundImages(cwd, [
    { mediaType: "image/png", data: Buffer.from("hello").toString("base64") },
  ]);
  assert.equal(attached.files[0], ".neo/inbox-images/paste-1.png");
  assert.equal(readFileSync(path.join(cwd, attached.files[0] ?? ""), "utf8"), "hello");
  assert.match(attached.note, /paste-1.png/);
});
