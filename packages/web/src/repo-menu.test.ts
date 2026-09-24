import assert from "node:assert/strict";
import test from "node:test";
import { placeRepoMenu } from "./repo-menu.js";

test("placeRepoMenu prefers the space above the trigger", () => {
  const placed = placeRepoMenu({
    trigger: { top: 520, left: 80, bottom: 548, width: 72 },
    menu: { width: 360, height: 160 },
    viewport: { width: 1280, height: 800 },
  });
  assert.equal(placed.width, 360);
  assert.equal(placed.left, 80);
  assert.equal(placed.top, 520 - 6 - 160);
});

test("placeRepoMenu flips below when there is no room above", () => {
  const placed = placeRepoMenu({
    trigger: { top: 20, left: 80, bottom: 48, width: 72 },
    menu: { width: 360, height: 160 },
    viewport: { width: 1280, height: 800 },
  });
  assert.equal(placed.top, 48 + 6);
});

test("placeRepoMenu aligns left and width to the composer box", () => {
  const placed = placeRepoMenu({
    trigger: { top: 520, left: 200, bottom: 548, width: 72 },
    menu: { width: 360, height: 160 },
    viewport: { width: 1280, height: 800 },
    align: { left: 256, width: 768 },
  });
  assert.equal(placed.left, 256);
  assert.equal(placed.width, 768);
  assert.equal(placed.top, 520 - 6 - 160);
});

test("placeRepoMenu keeps the aligned panel inside the viewport", () => {
  const placed = placeRepoMenu({
    trigger: { top: 520, left: 1100, bottom: 548, width: 72 },
    menu: { width: 360, height: 160 },
    viewport: { width: 1280, height: 800 },
    align: { left: 1100, width: 400 },
  });
  assert.equal(placed.left + placed.width, 1280 - 8);
});
