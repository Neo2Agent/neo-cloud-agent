import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_HOME_TEXTAREA_MAX,
  COMPOSER_MAX_PX,
  TRANSCRIPT_MAX_PX,
  composerBoxWidth,
  composerMaxWidth,
  composerTextareaHeight,
  transcriptColumnWidth,
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

test("follow-up composer uses the transcript column, not the stage ratio", () => {
  assert.equal(transcriptColumnWidth(1000), TRANSCRIPT_MAX_PX);
  assert.equal(transcriptColumnWidth(800), 752);
  assert.equal(transcriptColumnWidth(400), 352);
  assert.equal(transcriptColumnWidth(0), TRANSCRIPT_MAX_PX);
});

test("follow-up starts short and shares the New Chat max height", () => {
  assert.equal(composerTextareaHeight(20, true), 128);
  assert.equal(composerTextareaHeight(20, false), 24);
  assert.equal(composerTextareaHeight(180, false), 180);
  assert.equal(composerTextareaHeight(300, false), COMPOSER_HOME_TEXTAREA_MAX);
  assert.equal(composerTextareaHeight(300, true), COMPOSER_HOME_TEXTAREA_MAX);
});
