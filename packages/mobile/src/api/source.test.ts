import assert from "node:assert/strict";
import test from "node:test";
import { detectMobileSource, parseMobileScreen, parseRunIdFromHref } from "./source.js";

test("detectMobileSource treats iPhone as ios", () => {
  assert.equal(detectMobileSource("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), "ios");
  assert.equal(detectMobileSource("Mozilla/5.0 (Linux; Android 14)"), "android");
});

test("parseMobileScreen maps island routes", () => {
  assert.deepEqual(parseMobileScreen("#/"), { screen: "home", runId: null, inviteToken: null });
  assert.deepEqual(parseMobileScreen("#/experts"), { screen: "experts", runId: null, inviteToken: null });
  assert.deepEqual(parseMobileScreen("#/projects"), { screen: "projects", runId: null, inviteToken: null });
  assert.deepEqual(parseMobileScreen("#/automations"), { screen: "automations", runId: null, inviteToken: null });
  assert.deepEqual(parseMobileScreen("#/settings"), { screen: "settings", runId: null, inviteToken: null });
  assert.deepEqual(parseMobileScreen("#/memories"), { screen: "memories", runId: null, inviteToken: null });
  assert.deepEqual(parseMobileScreen("#/inbox"), { screen: "inbox", runId: null, inviteToken: null });
  assert.deepEqual(parseMobileScreen("#/skills"), { screen: "skills", runId: null, inviteToken: null });
  assert.deepEqual(parseMobileScreen("https://neorun.cloud/#/runs/r1"), { screen: "chat", runId: "r1", inviteToken: null });
  assert.deepEqual(parseMobileScreen("#/invite/tok"), { screen: "invite", runId: null, inviteToken: "tok" });
});

test("parseRunIdFromHref still reads custom scheme", () => {
  assert.equal(parseRunIdFromHref("neo://runs/abc"), "abc");
});

test("runDeepLink uses the neo scheme when no web host is given", async () => {
  const { runDeepLink } = await import("./source.js");
  assert.equal(runDeepLink("abc"), "neo://runs/abc");
  assert.equal(runDeepLink("abc", "https://neorun.cloud"), "https://neorun.cloud/#/runs/abc");
});
