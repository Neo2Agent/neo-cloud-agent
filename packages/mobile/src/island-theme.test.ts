import assert from "node:assert/strict";
import test from "node:test";
import { ISLAND, dayGreeting } from "./island-theme.ts";

test("island tokens match the shared Web monochrome workspace", () => {
  assert.equal(ISLAND.stage, "#f4f4f5");
  assert.equal(ISLAND.ink, "#1c1c1c");
  assert.equal(ISLAND.accent, "#1c1c1c");
  assert.equal(ISLAND.rail, "#ffffff");
});

test("dayGreeting follows Desk copy", () => {
  assert.equal(dayGreeting(new Date("2026-08-29T09:00:00")), "早上好");
  assert.equal(dayGreeting(new Date("2026-08-29T15:00:00")), "下午好");
  assert.equal(dayGreeting(new Date("2026-08-29T21:00:00")), "晚上好");
});
