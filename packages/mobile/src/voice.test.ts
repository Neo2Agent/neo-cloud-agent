import assert from "node:assert/strict";
import test from "node:test";
import { mergeSpokenText } from "./voice.js";

test("mergeSpokenText appends without doubling spaces", () => {
  assert.equal(mergeSpokenText("", "  加 README  "), "加 README");
  assert.equal(mergeSpokenText("先看 CI", "再开 PR"), "先看 CI 再开 PR");
});
