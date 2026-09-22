import assert from "node:assert/strict";
import test from "node:test";
import { clampPane, paneCeiling, paneHalf, paneSnapPhase, SIDEBAR_DEFAULT } from "./pane-size.js";

test("opening the inspector splits the row with the chat", () => {
  assert.equal(SIDEBAR_DEFAULT, 240);
  assert.equal(paneHalf(1280, 240), 520);
  assert.equal(1280 - 240 - paneHalf(1280, 240), 520);
  assert.equal(paneHalf(1440, 48), 696);
  assert.equal(paneHalf(1920, 48), 936);
  assert.equal(paneHalf(700, 240), 260);
});

test("drag can fill the row and snaps by share of that row", () => {
  assert.equal(paneCeiling(1280, 240), 1040);
  assert.equal(clampPane(2000, 1280, 240), 1040);
  assert.equal(clampPane(100, 1280, 240), 260);
  assert.equal(paneSnapPhase(520, 1280, 240), "idle");
  assert.equal(paneSnapPhase(720, 1280, 240), "hint");
  assert.equal(paneSnapPhase(860, 1280, 240), "hint");
});
