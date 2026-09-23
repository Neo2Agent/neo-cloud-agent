import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, routeHref } from "./nav.js";

test("parseRoute reads the page and falls back to overview", () => {
  assert.equal(parseRoute("").page, "overview");
  assert.equal(parseRoute("#/users").page, "users");
  assert.equal(parseRoute("#/runs?q=1").page, "runs");
  assert.equal(parseRoute("#/system").page, "system");
  assert.equal(parseRoute("#/experts").page, "experts");
  assert.equal(parseRoute("#/nope").page, "overview");
});

test("parseRoute keeps detail ids and type tabs", () => {
  assert.deepEqual(parseRoute("#/runs/run-1?tab=live"), { page: "runs", id: "run-1", tab: "live" });
  assert.deepEqual(parseRoute("#/users/u1"), { page: "users", id: "u1", tab: "" });
  assert.deepEqual(parseRoute("#/experts/exp_reviewer?tab=enabled"), {
    page: "experts",
    id: "exp_reviewer",
    tab: "enabled",
  });
  assert.equal(parseRoute("#/overview/ignored").id, "");
  assert.equal(routeHref("runs", { id: "run-1", tab: "error" }), "#/runs/run-1?tab=error");
  assert.equal(routeHref("users"), "#/users");
});
