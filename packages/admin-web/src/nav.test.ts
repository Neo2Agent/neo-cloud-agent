import assert from "node:assert/strict";
import test from "node:test";
import { parsePage, parseRoute, routeHref } from "./nav.js";

test("parsePage reads hash routes and falls back to overview", () => {
  assert.equal(parsePage(""), "overview");
  assert.equal(parsePage("#/users"), "users");
  assert.equal(parsePage("#/runs?q=1"), "runs");
  assert.equal(parsePage("#/system"), "system");
  assert.equal(parsePage("#/experts"), "experts");
  assert.equal(parsePage("#/nope"), "overview");
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
