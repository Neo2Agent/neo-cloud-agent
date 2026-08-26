import assert from "node:assert/strict";
import test from "node:test";
import { parseArgv, parseDuration } from "./parse.js";

test("parseDuration accepts ms s m h", () => {
  assert.equal(parseDuration("1500"), 1500);
  assert.equal(parseDuration("2s"), 2000);
  assert.equal(parseDuration("10m"), 600_000);
  assert.equal(parseDuration("1h"), 3_600_000);
});

test("bare prompt is the run command", () => {
  const parsed = parseArgv(["--repo", "fixtures/toy-repo", "-p", "just say pong"]);
  assert.equal(parsed.command, "run");
  assert.deepEqual(parsed.args, ["just say pong"]);
  assert.equal(parsed.flags.print, true);
  assert.deepEqual(parsed.flags.repos, ["fixtures/toy-repo"]);
});

test("explicit commands and repeated repos", () => {
  const parsed = parseArgv([
    "follow",
    "run-1",
    "do the tests",
    "--delivery=steer",
    "--output-format",
    "stream-json",
    "--repo",
    "a",
    "--repo",
    "b",
  ]);
  assert.equal(parsed.command, "follow");
  assert.deepEqual(parsed.args, ["run-1", "do the tests"]);
  assert.equal(parsed.flags.delivery, "steer");
  assert.equal(parsed.flags.output, "stream-json");
  assert.deepEqual(parsed.flags.repos, ["a", "b"]);
});

test("detach aliases and equals flags", () => {
  const parsed = parseArgv(["run", "--no-wait", "--url=http://example:8080", "--timeout=30s", "--json"]);
  assert.equal(parsed.flags.detach, true);
  assert.equal(parsed.flags.url, "http://example:8080");
  assert.equal(parsed.flags.timeoutMs, 30_000);
  assert.equal(parsed.flags.output, "json");
});

test("expert flags go onto the run command", () => {
  const parsed = parseArgv(["run", "--expert", "reviewer", "--expert-team=ship-change", "review the diff"]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.flags.expertId, "reviewer");
  assert.equal(parsed.flags.expertTeamId, "ship-change");
});

test("unknown flag is a usage error", () => {
  assert.throws(() => parseArgv(["run", "--yolo"]), /unknown flag/);
});

test("no args is help", () => {
  assert.equal(parseArgv([]).command, "help");
  assert.equal(parseArgv(["--help"]).command, "help");
});
