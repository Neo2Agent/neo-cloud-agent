import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_HOME_TEXTAREA_MAX,
  COMPOSER_MAX_PX,
  COMPOSER_MIN_PX,
  composerMaxWidth,
  composerTextareaHeight,
} from "./composer-size.js";

test("composer max width follows 92% of the stage up to the fig-2 cap", () => {
  assert.equal(composerMaxWidth(1000), 920);
  assert.equal(composerMaxWidth(1600), COMPOSER_MAX_PX);
  assert.equal(composerMaxWidth(400), 368);
  assert.equal(composerMaxWidth(0), COMPOSER_MAX_PX);
});

test("a very narrow window still leaves a usable composer", () => {
  assert.equal(composerMaxWidth(200), COMPOSER_MIN_PX);
});

test("follow-up starts short and shares the New Chat max height", () => {
  assert.equal(composerTextareaHeight(20, true), 128);
  assert.equal(composerTextareaHeight(20, false), 24);
  assert.equal(composerTextareaHeight(180, false), 180);
  assert.equal(composerTextareaHeight(300, false), COMPOSER_HOME_TEXTAREA_MAX);
  assert.equal(composerTextareaHeight(300, true), COMPOSER_HOME_TEXTAREA_MAX);
});
