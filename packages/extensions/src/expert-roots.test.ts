import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { AGENTS_DIR, NEO_DIR, expertAgentDirs, expertDocRoots } from "./expert-roots.js";

test("expertDocRoots prefers scratch then the workspace .neo", () => {
  const cwd = "/workspace/app";
  const scratch = "/workspace/app/.neo/runs/run-a";
  assert.deepEqual(expertDocRoots(cwd, scratch), [path.resolve(scratch), path.resolve(cwd, NEO_DIR)]);
});

test("expertDocRoots without scratch is just the workspace .neo", () => {
  const cwd = "/workspace/app";
  assert.deepEqual(expertDocRoots(cwd), [path.resolve(cwd, NEO_DIR)]);
  assert.deepEqual(expertDocRoots(cwd, "  "), [path.resolve(cwd, NEO_DIR)]);
});

test("expertAgentDirs lists project folders first and scratch last", () => {
  const cwd = "/workspace/app";
  const scratch = "/workspace/app/.neo/runs/run-a";
  assert.deepEqual(expertAgentDirs(cwd, scratch), [
    path.resolve(cwd, ".pi/agents"),
    path.resolve(cwd, ".cursor/agents"),
    path.resolve(cwd, ".neo/agents"),
    path.resolve(scratch, AGENTS_DIR),
  ]);
});

test("expertAgentDirs without scratch stays on the workspace project folders", () => {
  const cwd = "/workspace/app";
  assert.deepEqual(expertAgentDirs(cwd), [
    path.resolve(cwd, ".pi/agents"),
    path.resolve(cwd, ".cursor/agents"),
    path.resolve(cwd, ".neo/agents"),
  ]);
});
