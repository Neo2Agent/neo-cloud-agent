import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_MAX_PX,
  composerBoxWidth,
  composerMaxWidth,
  composerTextareaHeight,
} from "./composer-size.js";

test("composer max width follows 92% of the stage up to the fig-2 cap", () => {
  assert.equal(composerMaxWidth(1000), 920);
  assert.equal(composerMaxWidth(1600), COMPOSER_MAX_PX);
  assert.equal(composerMaxWidth(400), 368);
  assert.equal(composerMaxWidth(0), COMPOSER_MAX_PX);
});

test("home composer stays at the stage max instead of shrinking to typed text", () => {
  assert.equal(composerBoxWidth({ home: true, measuredText: 40, maxWidth: 880 }), 880);
});

test("follow-up composer uses the same stage max as New Chat", () => {
  assert.equal(composerBoxWidth({ home: false, measuredText: 10, maxWidth: 880, chrome: 96 }), 880);
  assert.equal(composerBoxWidth({ home: false, measuredText: 2000, maxWidth: 880, chrome: 96 }), 880);
});

test("home textarea starts taller than the follow-up bar", () => {
  assert.equal(composerTextareaHeight(20, true), 128);
  assert.equal(composerTextareaHeight(20, false), 72);
  assert.equal(composerTextareaHeight(300, true), 240);
});
