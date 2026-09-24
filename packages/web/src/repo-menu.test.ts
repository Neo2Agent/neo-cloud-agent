import assert from "node:assert/strict";
import test from "node:test";
import { placeRepoMenu } from "./repo-menu.js";

test("placeRepoMenu prefers the space above the trigger", () => {
  const placed = placeRepoMenu({
    trigger: { top: 520, left: 80, bottom: 548, width: 72 },
    menu: { width: 280, height: 160 },
    viewport: { width: 1280, height: 800 },
  });
  assert.equal(placed.width, 280);
  assert.equal(placed.left, 80);
  assert.equal(placed.top, 520 - 4 - 160);
});

test("placeRepoMenu flips below when there is no room above", () => {
  const placed = placeRepoMenu({
    trigger: { top: 20, left: 80, bottom: 48, width: 72 },
    menu: { width: 280, height: 160 },
    viewport: { width: 1280, height: 800 },
  });
  assert.equal(placed.top, 48 + 4);
});

test("placeRepoMenu hangs from the trigger and stays inside the composer", () => {
  const placed = placeRepoMenu({
    trigger: { top: 520, left: 320, bottom: 548, width: 72 },
    menu: { width: 360, height: 160 },
    viewport: { width: 1280, height: 800 },
    clamp: { left: 256, width: 768 },
  });
  assert.equal(placed.width, 300);
  assert.equal(placed.left, 320);
  assert.equal(placed.top, 520 - 4 - 160);
});

test("placeRepoMenu keeps a compact panel inside the viewport", () => {
  const placed = placeRepoMenu({
    trigger: { top: 520, left: 1100, bottom: 548, width: 72 },
    menu: { width: 360, height: 160 },
    viewport: { width: 1280, height: 800 },
  });
  assert.equal(placed.width, 300);
  assert.equal(placed.left + placed.width, 1280 - 8);
});

test("placeRepoMenu shifts left when the trigger would overflow the composer", () => {
  const placed = placeRepoMenu({
    trigger: { top: 520, left: 900, bottom: 548, width: 72 },
    menu: { width: 280, height: 160 },
    viewport: { width: 1280, height: 800 },
    clamp: { left: 256, width: 400 },
  });
  assert.equal(placed.width, 280);
  assert.equal(placed.left, 256 + 400 - 280);
});
