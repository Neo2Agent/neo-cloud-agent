import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("password hashes are not reversible and verify only the original secret", () => {
  const encoded = hashPassword("correct horse");
  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes("correct horse"), false);
  assert.equal(verifyPassword("correct horse", encoded), true);
  assert.equal(verifyPassword("wrong", encoded), false);
  assert.equal(verifyPassword("correct horse", "not-a-hash"), false);
});
