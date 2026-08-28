import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  ignoreNeoDir,
  isGitRepo,
  localWorkspaceDiffStat,
  prepareDeskWorkspace,
  readRepoIdentity,
  resolveAuthorizedFolder,
  runScratchDir,
  runStateDir,
  unboundThisComputerFolder,
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
  assert.equal(workspace, realpathSync(dir));
  assert.equal(existsSync(path.join(dir, ".neo", "worktrees")), false);
});

test("a plain folder works too, it just has no git tools", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-desk-plain-"));
  assert.equal(isGitRepo(dir), false);
  assert.equal(await prepareDeskWorkspace({ repoDir: dir }), realpathSync(dir));
  const identity = await readRepoIdentity(dir);
  assert.equal(identity.git, false);
  assert.match(identity.repoKey, /^local:/);
});

test("a missing folder fails before anything spawns", async () => {
  await assert.rejects(prepareDeskWorkspace({ repoDir: path.join(tmpdir(), "neo-desk-missing-xyz") }), /不存在/);
});

test("This Computer without a folder uses a scratch dir under userData", () => {
  const userData = mkdtempSync(path.join(tmpdir(), "neo-desk-unbound-"));
  const first = unboundThisComputerFolder(userData);
  const again = unboundThisComputerFolder(userData);
  assert.equal(first, again);
  assert.equal(path.basename(first), "scratch");
  assert.equal(existsSync(first), true);
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

test("expert files land in the run's own scratch and .neo is excluded from git", async () => {
  const dir = initRepo();
  const workspace = await prepareDeskWorkspace({ repoDir: dir });
  const scratch = runScratchDir(workspace, "run-a");
  writeRunExpertFiles(workspace, scratch, {
    expertMarkdown: "Role Override: reviewer\n",
    expertMeta: JSON.stringify({ id: "exp_reviewer", slug: "reviewer", name: "审查", kind: "expert" }),
    expertAgents: [{ slug: "planner", markdown: "---\nname: planner\n---\nplan\n" }],
  });
  assert.match(readFileSync(path.join(scratch, "EXPERT.md"), "utf8"), /Role Override/);
  assert.match(readFileSync(path.join(scratch, "expert.json"), "utf8"), /exp_reviewer/);
  assert.match(readFileSync(path.join(scratch, "agents", "planner.md"), "utf8"), /planner/);
  // The shared folder must stay clean, or the next run would read this persona.
  assert.equal(existsSync(path.join(workspace, ".neo", "EXPERT.md")), false);
  assert.match(readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8"), /^\.neo\/$/m);
  ignoreNeoDir(workspace);
  const exclude = readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  assert.equal(exclude.match(/^\.neo\/$/gm)?.length, 1);
});

test("two runs sharing one folder keep separate experts", async () => {
  const dir = initRepo();
  const workspace = await prepareDeskWorkspace({ repoDir: dir });
  const first = runScratchDir(workspace, "run-a");
  const second = runScratchDir(workspace, "run-b");
  assert.notEqual(first, second);
  writeRunExpertFiles(workspace, first, { expertMarkdown: "Role Override: reviewer\n" });
  writeRunExpertFiles(workspace, second, { expertMarkdown: "Role Override: planner\n" });
  assert.match(readFileSync(path.join(first, "EXPERT.md"), "utf8"), /reviewer/);
  assert.match(readFileSync(path.join(second, "EXPERT.md"), "utf8"), /planner/);
});

test("authorizing a folder uses realpath and refuses home", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-desk-auth-"));
  const ok = resolveAuthorizedFolder(dir);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.path, realpathSync(dir));
    assert.equal(ok.overlyBroad, false);
  }
  const home = resolveAuthorizedFolder(homedir());
  assert.equal(home.ok, false);
  if (!home.ok) {
    assert.equal(home.reason, "home-or-root");
  }
  const missing = resolveAuthorizedFolder(path.join(tmpdir(), "neo-desk-auth-missing-xyz"));
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "unreadable");
  }
});

test("diff stat counts uncommitted edits in the user's own folder", async () => {
  const dir = initRepo();
  assert.deepEqual(await localWorkspaceDiffStat(dir), { added: 0, removed: 0 });
  writeFileSync(path.join(dir, "README.md"), "hi\nthere\n");
  const stat = await localWorkspaceDiffStat(dir);
  assert.equal(stat?.added, 1);
  assert.equal(await localWorkspaceDiffStat(mkdtempSync(path.join(tmpdir(), "neo-desk-nogit-"))), null);
});
