import assert from "node:assert/strict";
import test from "node:test";
import { placeRepoMenu } from "./repo-menu.js";

test("placeRepoMenu prefers the space above the trigger", () => {
  const placed = placeRepoMenu(
    { top: 520, left: 80, bottom: 548, width: 72 },
    { width: 360, height: 240 },
    { width: 1280, height: 800 },
  );
  assert.equal(placed.width, 360);
  assert.equal(placed.left, 80);
  assert.equal(placed.top, 520 - 6 - 240);
});

test("placeRepoMenu flips below when there is no room above", () => {
  const placed = placeRepoMenu(
    { top: 20, left: 80, bottom: 48, width: 72 },
    { width: 360, height: 240 },
    { width: 1280, height: 800 },
  );
  assert.equal(placed.top, 48 + 6);
});

test("placeRepoMenu keeps the panel inside the viewport", () => {
  const placed = placeRepoMenu(
    { top: 520, left: 1100, bottom: 548, width: 72 },
    { width: 360, height: 240 },
    { width: 1280, height: 800 },
  );
  assert.equal(placed.left + placed.width, 1280 - 8);
});
