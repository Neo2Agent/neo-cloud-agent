import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEgress, hostnameFromTarget, hostMatches, mergeEgressPolicy } from "./egress.js";

test("hostnameFromTarget understands git remotes and local paths", () => {
  assert.equal(hostnameFromTarget("https://github.com/acme/app.git"), "github.com");
  assert.equal(hostnameFromTarget("git@github.com:acme/app.git"), "github.com");
  assert.equal(hostnameFromTarget("github.com/acme/app"), "github.com");
  assert.equal(hostnameFromTarget("fixtures/toy-repo"), null);
  assert.equal(hostnameFromTarget("/tmp/repo"), null);
  assert.equal(hostnameFromTarget("file:///tmp/repo"), null);
});

test("hostMatches treats a domain as itself and its subdomains", () => {
  assert.equal(hostMatches("github.com", "github.com"), true);
  assert.equal(hostMatches("api.github.com", "github.com"), true);
  assert.equal(hostMatches("evil.com", "github.com"), false);
  assert.equal(hostMatches("notgithub.com", "github.com"), false);
});

test("default_plus_allowlist includes registries plus the user list", () => {
  const policy = mergeEgressPolicy({ mode: "default_plus_allowlist", domains: ["example.com"] }, ["llm.internal"]);
  assert.equal(evaluateEgress(policy, "https://registry.npmjs.org/leftpad").allow, true);
  assert.equal(evaluateEgress(policy, "https://example.com/x").allow, true);
  assert.equal(evaluateEgress(policy, "https://llm.internal/v1").allow, true);
  assert.equal(evaluateEgress(policy, "https://evil.example/x").allow, false);
});

test("allowlist_only still lets Gateway/SCM through and blocks the rest", () => {
  const policy = mergeEgressPolicy({ mode: "allowlist_only", domains: ["pkgs.example"] }, ["gw.internal"]);
  assert.equal(evaluateEgress(policy, "https://github.com/acme/app").allow, true);
  assert.equal(evaluateEgress(policy, "https://gw.internal/v1").allow, true);
  assert.equal(evaluateEgress(policy, "https://pkgs.example/foo").allow, true);
  assert.equal(evaluateEgress(policy, "https://evil.example/x").allow, false);
  assert.equal(evaluateEgress(policy, "fixtures/toy-repo").allow, true);
});

test("allow_all never denies", () => {
  assert.equal(evaluateEgress({ mode: "allow_all" }, "https://evil.example").allow, true);
});
