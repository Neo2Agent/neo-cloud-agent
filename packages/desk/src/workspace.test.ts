import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ignoreNeoDir,
  isGitRepo,
  localWorkspaceDiffStat,
  prepareDeskWorkspace,
  readRepoIdentity,
  runStateDir,
  writeRunBootstrap,
  writeRunExpertFiles,
} from "./workspace.js";

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-desk-ws-"));
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "desk@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Desk"], { cwd: dir });
  writeFileSync(path.join(dir, "README.md"), "hi\n");
  spawnSync("git", ["add", "."], { cwd: dir });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

test("the workspace is the folder the user picked, not a side worktree", async () => {
  const dir = initRepo();
  const workspace = await prepareDeskWorkspace({ repoDir: dir });
  assert.equal(workspace, path.resolve(dir));
  assert.equal(existsSync(path.join(dir, ".neo", "worktrees")), false);
});

test("a plain folder works too, it just has no git tools", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-desk-plain-"));
  assert.equal(isGitRepo(dir), false);
  assert.equal(await prepareDeskWorkspace({ repoDir: dir }), path.resolve(dir));
  const identity = await readRepoIdentity(dir);
  assert.equal(identity.git, false);
  assert.match(identity.repoKey, /^local:/);
});

test("a missing folder fails before anything spawns", async () => {
  await assert.rejects(prepareDeskWorkspace({ repoDir: path.join(tmpdir(), "neo-desk-missing-xyz") }), /不存在/);
});

test("run state stays out of the repo", () => {
  const repo = initRepo();
  const userData = mkdtempSync(path.join(tmpdir(), "neo-desk-state-"));
  const stateDir = runStateDir(userData, "aaaaaaaa-bbbb");
  writeRunBootstrap(stateDir, { runId: "aaaaaaaa-bbbb", jwt: "secret" });
  assert.equal(existsSync(path.join(stateDir, "run-bootstrap.json")), true);
  assert.equal(existsSync(path.join(repo, ".neo", "run-bootstrap.json")), false);
  assert.equal(existsSync(path.join(repo, "sessions")), false);
});

test("plugin files land next to expert files", async () => {
  const dir = initRepo();
  const workspace = await prepareDeskWorkspace({ repoDir: dir });
  writeRunExpertFiles(workspace, {
    pluginSnapshot: JSON.stringify({ plugins: [{ slug: "pr-review", version: "1.0.0", digest: "abc" }], warnings: [] }),
    pluginSkills: [{ slug: "pr-review", files: [{ relativePath: "SKILL.md", content: "---\nname: pr-review\ndescription: Review a PR.\n---\n\nReview.\n" }] }],
  });
  assert.match(readFileSync(path.join(workspace, ".neo", "plugins.json"), "utf8"), /pr-review/);
  assert.match(readFileSync(path.join(workspace, ".neo", "skills", "pr-review", "SKILL.md"), "utf8"), /Review/);
});

test("expert files land in the workspace and .neo is excluded from git", async () => {
  const dir = initRepo();
  const workspace = await prepareDeskWorkspace({ repoDir: dir });
  writeRunExpertFiles(workspace, {
    expertMarkdown: "Role Override: reviewer\n",
    expertMeta: JSON.stringify({ id: "exp_reviewer", slug: "reviewer", name: "审查", kind: "expert" }),
    expertAgents: [{ slug: "planner", markdown: "---\nname: planner\n---\nplan\n" }],
  });
  assert.match(readFileSync(path.join(workspace, ".neo", "EXPERT.md"), "utf8"), /Role Override/);
  assert.match(readFileSync(path.join(workspace, ".neo", "expert.json"), "utf8"), /exp_reviewer/);
  assert.match(readFileSync(path.join(workspace, ".neo", "agents", "planner.md"), "utf8"), /planner/);
  assert.match(readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8"), /^\.neo\/$/m);
  ignoreNeoDir(workspace);
  const exclude = readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  assert.equal(exclude.match(/^\.neo\/$/gm)?.length, 1);
});

test("diff stat counts uncommitted edits in the user's own folder", async () => {
  const dir = initRepo();
  assert.deepEqual(await localWorkspaceDiffStat(dir), { added: 0, removed: 0 });
  writeFileSync(path.join(dir, "README.md"), "hi\nthere\n");
  const stat = await localWorkspaceDiffStat(dir);
  assert.equal(stat?.added, 1);
  assert.equal(await localWorkspaceDiffStat(mkdtempSync(path.join(tmpdir(), "neo-desk-nogit-"))), null);
});
