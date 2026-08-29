import assert from "node:assert/strict";
import test from "node:test";
import { detectMobileSource, parseMobileScreen, parseRunIdFromHref } from "./source.js";

test("detectMobileSource treats iPhone as ios", () => {
  assert.equal(detectMobileSource("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "ios");
  assert.equal(detectMobileSource("Mozilla/5.0 (Linux; Android 14)"), "android");
});

test("parseMobileScreen maps buddy routes", () => {
  assert.deepEqual(parseMobileScreen("#/"), { screen: "home", runId: null });
  assert.deepEqual(parseMobileScreen("#/experts"), { screen: "experts", runId: null });
  assert.deepEqual(parseMobileScreen("#/skills"), { screen: "skills", runId: null });
  assert.deepEqual(parseMobileScreen("#/projects"), { screen: "projects", runId: null });
  assert.deepEqual(parseMobileScreen("#/settings"), { screen: "settings", runId: null });
  assert.deepEqual(parseMobileScreen("https://neorun.cloud/#/runs/r1"), { screen: "chat", runId: "r1" });
});

test("parseRunIdFromHref still reads custom scheme", () => {
  assert.equal(parseRunIdFromHref("neo://runs/abc"), "abc");
});
