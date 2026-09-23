import assert from "node:assert/strict";
import test from "node:test";
import { clampPane, paneCeiling, paneDefault, paneSnapPhase, SIDEBAR_DEFAULT } from "./pane-size.js";

test("opening the inspector uses 46% of the page, not half the leftover row", () => {
  assert.equal(SIDEBAR_DEFAULT, 280);
  assert.equal(paneDefault(1440, 240), 662);
  assert.equal(1440 - 240 - paneDefault(1440, 240), 538);
  assert.equal(paneDefault(1024, 240), 446);
  assert.equal(paneDefault(1920, 48), 883);
  assert.equal(paneDefault(700, 240), 260);
});

test("drag can fill the row and snaps by share of that row", () => {
  assert.equal(paneCeiling(1280, 240), 1040);
  assert.equal(clampPane(2000, 1280, 240), 1040);
  assert.equal(clampPane(100, 1280, 240), 260);
  assert.equal(paneSnapPhase(520, 1280, 240), "idle");
  assert.equal(paneSnapPhase(720, 1280, 240), "hint");
  assert.equal(paneSnapPhase(860, 1280, 240), "hint");
});
