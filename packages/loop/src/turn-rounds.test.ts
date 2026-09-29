import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyRepeat, isRunaway, SAFETY_TOOL_ROUNDS, toolSignature } from "./repeat.js";

test("the same command runs once, replays the second time, and stops on the third", () => {
  const signature = toolSignature("bash", { command: "ls" });
  const first = classifyRepeat({ last: "", streak: 0 }, signature);
  assert.equal(first.action, "run");
  const second = classifyRepeat(first.state, signature);
  assert.equal(second.action, "replay");
  const third = classifyRepeat(second.state, toolSignature("bash", { command: "ls" }));
  assert.equal(third.action, "stop");
});

test("a different command resets the repeat streak", () => {
  const first = classifyRepeat({ last: "", streak: 0 }, toolSignature("bash", { command: "ls" }));
  const again = classifyRepeat(first.state, toolSignature("bash", { command: "ls" }));
  const other = classifyRepeat(again.state, toolSignature("read", { path: "a.md" }));
  assert.equal(other.action, "run");
  assert.equal(other.state.streak, 1);
});

test("argument key order does not make the same command look new", () => {
  assert.equal(toolSignature("bash", { command: "ls", cwd: "." }), toolSignature("bash", { cwd: ".", command: "ls" }));
});

test("a turn that never stops is a runaway only past the safety ceiling", () => {
  assert.equal(isRunaway(SAFETY_TOOL_ROUNDS), false);
  assert.equal(isRunaway(SAFETY_TOOL_ROUNDS + 1), true);
});

test("the remote loop no longer fails a normal explore for too many rounds", () => {
  const source = readFileSync(new URL("./turn.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /工具回合过多/);
  assert.doesNotMatch(source, /MAX_ROUNDS/);
  assert.match(source, /DUPLICATE_STOP/);
  assert.match(source, /RUNAWAY_STOP/);
});
