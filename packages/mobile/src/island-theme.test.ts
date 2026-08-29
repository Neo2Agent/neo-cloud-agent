import assert from "node:assert/strict";
import test from "node:test";
import { ISLAND, dayGreeting } from "./island-theme.js";

test("island tokens match Desk parchment", () => {
  assert.equal(ISLAND.stage, "#f7f3df");
  assert.equal(ISLAND.ink, "#794f27");
  assert.equal(ISLAND.accent, "#19c8b9");
  assert.equal(ISLAND.rail, "#f0e8d8");
});

test("dayGreeting follows Desk copy", () => {
  assert.equal(dayGreeting(new Date("2026-08-29T09:00:00")), "早上好");
  assert.equal(dayGreeting(new Date("2026-08-29T15:00:00")), "下午好");
  assert.equal(dayGreeting(new Date("2026-08-29T21:00:00")), "晚上好");
});
