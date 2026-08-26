import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { isGitRepo, prepareDeskWorkspace, writeRunBootstrap, writeRunExpertFiles } from "./workspace.js";

test("prepareDeskWorkspace requires a git repo and opens a worktree", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-desk-ws-"));
  assert.equal(isGitRepo(dir), false);
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "desk@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Desk"], { cwd: dir });
  writeFileSync(path.join(dir, "README.md"), "hi\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  assert.equal(isGitRepo(dir), true);
  const worktree = await prepareDeskWorkspace({ repoDir: dir, runId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
  assert.equal(worktree.includes(".neo/worktrees/aaaaaaaa"), true);
  writeRunBootstrap(worktree, { runId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
  assert.equal(existsSync(path.join(worktree, ".neo", "run-bootstrap.json")), true);
  writeRunExpertFiles(worktree, {
    expertMarkdown: "Role Override: reviewer\n",
    expertMeta: JSON.stringify({ id: "exp_reviewer", slug: "reviewer", name: "审查", kind: "expert" }),
    expertAgents: [{ slug: "planner", markdown: "---\nname: planner\n---\nplan\n" }],
  });
  assert.match(readFileSync(path.join(worktree, ".neo", "EXPERT.md"), "utf8"), /Role Override/);
  assert.match(readFileSync(path.join(worktree, ".neo", "expert.json"), "utf8"), /exp_reviewer/);
  assert.match(readFileSync(path.join(worktree, ".neo", "agents", "planner.md"), "utf8"), /planner/);
});
