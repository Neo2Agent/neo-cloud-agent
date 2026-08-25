import assert from "node:assert/strict";
import test from "node:test";
import { parsePage } from "./nav.js";

test("parsePage reads hash routes and falls back to overview", () => {
  assert.equal(parsePage(""), "overview");
  assert.equal(parsePage("#/users"), "users");
  assert.equal(parsePage("#/runs?q=1"), "runs");
  assert.equal(parsePage("#/system"), "system");
  assert.equal(parsePage("#/nope"), "overview");
});
