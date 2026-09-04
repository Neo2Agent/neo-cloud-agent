import assert from "node:assert/strict";
import test from "node:test";
import { MEMORY_LIST_LIMIT_DEFAULT, MEMORY_LIST_LIMIT_MAX } from "@neo-cloud-agent/contracts";
import { normalizeLimit } from "./service.js";

test("normalizeLimit falls back for missing illegal and sub-one values", () => {
  assert.equal(normalizeLimit(undefined, MEMORY_LIST_LIMIT_DEFAULT, MEMORY_LIST_LIMIT_MAX), 50);
  assert.equal(normalizeLimit(null, 50, 100), 50);
  assert.equal(normalizeLimit("", 50, 100), 50);
  assert.equal(normalizeLimit("abc", 50, 100), 50);
  assert.equal(normalizeLimit(Number.NaN, 50, 100), 50);
  assert.equal(normalizeLimit(-5, 50, 100), 50);
  assert.equal(normalizeLimit(0, 50, 100), 50);
});

test("normalizeLimit truncates fractions and clamps the max", () => {
  assert.equal(normalizeLimit(3.7, 50, 100), 3);
  assert.equal(normalizeLimit("3.7", 50, 100), 3);
  assert.equal(normalizeLimit(100, 50, 100), 100);
  assert.equal(normalizeLimit(101, 50, 100), 100);
  assert.equal(normalizeLimit(1e9, 8, 32), 32);
});
