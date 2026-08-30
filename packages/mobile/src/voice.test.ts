import assert from "node:assert/strict";
import test from "node:test";
import { mergeSpokenText, preferSpokenText } from "./voice.js";

test("mergeSpokenText appends without doubling spaces", () => {
  assert.equal(mergeSpokenText("", "  加 README  "), "加 README");
  assert.equal(mergeSpokenText("先看 CI", "再开 PR"), "先看 CI 再开 PR");
});

test("preferSpokenText does not replace a sentence with a lone question mark", () => {
  assert.equal(preferSpokenText("你好你可以做什么", "？"), "你好你可以做什么？");
  assert.equal(preferSpokenText("你好你可以做什么", "?"), "你好你可以做什么?");
  assert.equal(preferSpokenText("请打开", "请打开设置"), "请打开设置");
});
