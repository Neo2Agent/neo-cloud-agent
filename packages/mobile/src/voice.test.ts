import assert from "node:assert/strict";
import test from "node:test";
import { HOLD_VOICE_MS, finishHoldVoice, isVoiceHoldTap, mergeSpokenText } from "./voice.js";

test("mergeSpokenText appends without doubling spaces", () => {
  assert.equal(mergeSpokenText("", "  加 README  "), "加 README");
  assert.equal(mergeSpokenText("先看 CI", "再开 PR"), "先看 CI 再开 PR");
});

test("finishHoldVoice discards a tap and keeps a hold", () => {
  assert.equal(HOLD_VOICE_MS, 280);
  assert.equal(isVoiceHoldTap(80), true);
  assert.equal(isVoiceHoldTap(280), false);
  assert.equal(finishHoldVoice({ heldMs: 80, spoken: "你好你可以做什么" }), "");
  assert.equal(finishHoldVoice({ heldMs: 280, spoken: "  你好你可以做什么  " }), "你好你可以做什么");
});
