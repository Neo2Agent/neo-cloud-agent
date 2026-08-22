import assert from "node:assert/strict";
import test from "node:test";
import { databaseKindFromUrl } from "./database.js";

test("rejects empty DATABASE_URL scheme", () => {
  assert.throws(() => databaseKindFromUrl(""), /unsupported DATABASE_URL/);
});
