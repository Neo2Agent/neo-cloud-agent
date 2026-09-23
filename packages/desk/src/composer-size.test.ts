import assert from "node:assert/strict";
import test from "node:test";
import { COMPOSER_HOME_TEXTAREA_MAX, composerTextareaHeight } from "./composer-size.js";

test("follow-up starts short and shares the New Chat max height", () => {
  assert.equal(composerTextareaHeight(20, true), 56);
  assert.equal(composerTextareaHeight(20, false), 24);
  assert.equal(composerTextareaHeight(180, false), 180);
  assert.equal(composerTextareaHeight(300, false), COMPOSER_HOME_TEXTAREA_MAX);
  assert.equal(composerTextareaHeight(300, true), COMPOSER_HOME_TEXTAREA_MAX);
});
