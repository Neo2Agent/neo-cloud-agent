import assert from "node:assert/strict";
import test from "node:test";
import type { ImageRef } from "@neo-cloud-agent/contracts/run";
import {
  acceptImages,
  base64Bytes,
  canAttachMore,
  fitWithin,
  imageHint,
  jpegImageRef,
  MAX_IMAGES,
  overImageBudget,
  totalImageBytes,
} from "./images.js";

function ref(bytes: number): ImageRef {
  return { mediaType: "image/jpeg", data: Buffer.alloc(bytes, 1).toString("base64") };
}

test("fitWithin only shrinks, and keeps the aspect ratio", () => {
  // A 12MP portrait photo lands on the long edge.
  assert.deepEqual(fitWithin(3024, 4032), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(4032, 3024), { width: 1600, height: 1200 });
  // Already small enough stays untouched.
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1600, 1600), { width: 1600, height: 1600 });
});

test("fitWithin survives degenerate sizes", () => {
  assert.deepEqual(fitWithin(0, 0), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(Number.NaN, 10), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(10_000, 1), { width: 1600, height: 1 });
});

test("base64Bytes counts decoded bytes and tolerates a data URI prefix", () => {
  assert.equal(base64Bytes(Buffer.alloc(1024).toString("base64")), 1024);
  assert.equal(base64Bytes(Buffer.alloc(1023).toString("base64")), 1023);
  assert.equal(base64Bytes(`data:image/jpeg;base64,${Buffer.alloc(512).toString("base64")}`), 512);
  assert.equal(base64Bytes(""), 0);
});

test("attachments cap at the same 4 the worker slices to", () => {
  const four = acceptImages([], [ref(1), ref(1), ref(1), ref(1)]);
  assert.equal(four.length, MAX_IMAGES);
  assert.equal(acceptImages(four, [ref(1)]).length, MAX_IMAGES);
  assert.equal(canAttachMore(four), false);
  assert.equal(canAttachMore(four.slice(0, 3)), true);
});

test("totalImageBytes sums the decoded payloads", () => {
  assert.equal(totalImageBytes([ref(1000), ref(2000)]), 3000);
  assert.equal(totalImageBytes([]), 0);
});

test("imageHint reports count and size, and warns past the budget", () => {
  assert.equal(imageHint([]), "");
  assert.match(imageHint([ref(300 * 1024)]), /^1\/4 张 · 300KB$/);
  assert.match(imageHint([ref(2 * 1024 * 1024)]), /2\.0MB/);
  const huge = [ref(4 * 1024 * 1024), ref(4 * 1024 * 1024)];
  assert.match(imageHint(huge), /太大了/);
  assert.equal(overImageBudget(huge), true);
  assert.equal(overImageBudget([ref(1024)]), false);
});

test("jpegImageRef normalizes the media type and strips a data URI prefix", () => {
  const payload = Buffer.from("jpeg").toString("base64");
  assert.deepEqual(jpegImageRef(payload), { mediaType: "image/jpeg", data: payload });
  assert.deepEqual(jpegImageRef(`data:image/jpeg;base64,${payload}`), {
    mediaType: "image/jpeg",
    data: payload,
  });
});
