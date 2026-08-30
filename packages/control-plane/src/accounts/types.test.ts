import assert from "node:assert/strict";
import test from "node:test";
import { isValidLogin, isValidPhone, isValidUsername, normalizePhone } from "./types.js";

test("normalizePhone strips +86 and punctuation", () => {
  assert.equal(normalizePhone("+86 138-0013-8000"), "13800138000");
  assert.equal(normalizePhone("8613900139000"), "13900139000");
  assert.equal(normalizePhone("13800138000"), "13800138000");
});

test("isValidPhone accepts mainland mobiles only", () => {
  assert.equal(isValidPhone("13800138000"), true);
  assert.equal(isValidPhone("12900138000"), false);
  assert.equal(isValidPhone("1380013800"), false);
});

test("isValidUsername rejects emails and phones", () => {
  assert.equal(isValidUsername("ada"), true);
  assert.equal(isValidUsername("ada@example.com"), false);
  assert.equal(isValidUsername("13800138000"), false);
  assert.equal(isValidLogin("ada@example.com"), true);
  assert.equal(isValidLogin("admin"), true);
});
