import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import type { DeskAssignment } from "@neo-cloud-agent/contracts";
import { deskRepoKey, deskWorkspaceShortName } from "@neo-cloud-agent/contracts/desk-workspace";
import {
  FOLDER_UNREADABLE_MESSAGE,
  HOME_OR_ROOT_REJECT_MESSAGE,
  isHomeOrFilesystemRoot,
  isOverlyBroadFolder,
} from "./folder-auth.js";

/** Same filenames as a cloud run. Local addressing adds `runs/<id>` under this. */
const NEO_DIR = ".neo";
const AGENTS_DIR = "agents";
const SKILLS_DIR = "skills";
const RUNS_DIR = "runs";
/** This Computer with no picked folder works here, like Cloud with no repo. */
const UNBOUND_SCRATCH_DIR = "scratch";

export function isGitRepo(folder: string): boolean {
  return existsSync(path.join(folder, ".git"));
}

export type AuthorizedFolder =
  | { ok: true; path: string; overlyBroad: boolean }
  | { ok: false; reason: "unreadable" | "home-or-root"; message: string };

/**
 * Resolve the folder the user picked before it becomes a workspace.
 *
 * `realpath` follows symlinks so a link to home or `/` cannot sneak through.
 * Home and the filesystem root are refused; overly-broad parents need a second
 * confirm in the host, which only shows the dialog.
 */
export function resolveAuthorizedFolder(folder: string, homeDir = homedir()): AuthorizedFolder {
  let resolved: string;
  try {
    resolved = realpathSync(folder);
  } catch {
    return { ok: false, reason: "unreadable", message: `${FOLDER_UNREADABLE_MESSAGE} ${folder}` };
  }
  if (isHomeOrFilesystemRoot(resolved, homeDir)) {
    return { ok: false, reason: "home-or-root", message: HOME_OR_ROOT_REJECT_MESSAGE };
  }
  return { ok: true, path: resolved, overlyBroad: isOverlyBroadFolder(resolved) };
}

/**
 * The workspace is the folder the user picked, in place.
 *
 * Cursor's This Computer works on the checkout you opened, so the agent sees the
 * files you are editing right now. An isolated worktree would hide uncommitted
 * work and drop the agent's edits somewhere you never look.
 */
export async function prepareDeskWorkspace(input: { repoDir: string }): Promise<string> {
  const folder = input.repoDir.trim();
  if (!folder) {
    throw new Error("本机执行需要先选一个文件夹");
  }
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new Error(`本机工作区不存在：${folder}`);
  }
  return realpathSync(folder);
}

/** Default cwd when This Computer starts without a user-picked folder. */
export function unboundThisComputerFolder(userDataDir: string): string {
  const dest = path.join(userDataDir, UNBOUND_SCRATCH_DIR);
  mkdirSync(dest, { recursive: true });
  return dest;
}

/** Where per-run state lives, kept out of the user's repo. */
export function runStateDir(userDataDir: string, runId: string): string {
  const dest = path.join(userDataDir, "runs", runId);
  mkdirSync(dest, { recursive: true });
  return dest;
}

export function writeRunBootstrap(stateDir: string, bootstrap: Record<string, unknown>): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, "run-bootstrap.json"), `${JSON.stringify(bootstrap, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Per-run scratch inside the workspace.
 *
 * Two local conversations are allowed to share a folder, so anything written for
 * one run has to be addressed by run id. `.neo/runs/` is already excluded from
 * commits and skipped by workspace copies.
 */
export function runScratchDir(workspaceDir: string, runId: string): string {
  const dest = path.join(path.resolve(workspaceDir), NEO_DIR, RUNS_DIR, runId);
  mkdirSync(dest, { recursive: true });
  return dest;
}

/**
 * Expert files have to sit in the workspace because the worker's loader reads
 * them from disk. They go under the run's own scratch so a second conversation
 * in the same folder cannot swap this run's persona out from under it.
 */
export function writeRunExpertFiles(
  workspaceDir: string,
  scratchDir: string,
  assignment: Pick<DeskAssignment, "expertMarkdown" | "expertTeamMarkdown" | "expertMeta" | "expertAgents" | "pluginSkills" | "pluginSnapshot">,
): void {
  if (
    !assignment.expertMeta &&
    !assignment.expertMarkdown &&
    !assignment.expertTeamMarkdown &&
    !assignment.expertAgents?.length &&
    !assignment.pluginSnapshot &&
    !assignment.pluginSkills?.length
  ) {
    return;
  }
  const dest = scratchDir;
  mkdirSync(dest, { recursive: true });
  if (assignment.expertMeta) {
    writeFileSync(path.join(dest, "expert.json"), assignment.expertMeta.endsWith("\n") ? assignment.expertMeta : `${assignment.expertMeta}\n`);
  }
  if (assignment.expertMarkdown) {
    writeFileSync(path.join(dest, "EXPERT.md"), assignment.expertMarkdown);
  }
  if (assignment.expertTeamMarkdown) {
    writeFileSync(path.join(dest, "EXPERT_TEAM.md"), assignment.expertTeamMarkdown);
  }
  if (assignment.expertAgents?.length) {
    const agentsDir = path.join(dest, AGENTS_DIR);
    mkdirSync(agentsDir, { recursive: true });
    for (const agent of assignment.expertAgents) {
      writeFileSync(path.join(agentsDir, `${agent.slug}.md`), agent.markdown);
    }
  }
  if (assignment.pluginSnapshot) {
    writeFileSync(
      path.join(dest, "plugins.json"),
      assignment.pluginSnapshot.endsWith("\n") ? assignment.pluginSnapshot : `${assignment.pluginSnapshot}\n`,
    );
  }
  if (assignment.pluginSkills?.length) {
    for (const skill of assignment.pluginSkills) {
      const skillDir = path.join(dest, SKILLS_DIR, skill.slug);
      mkdirSync(skillDir, { recursive: true });
      for (const file of skill.files) {
        writeFileSync(path.join(skillDir, file.relativePath), file.content);
      }
    }
  }
  ignoreNeoDir(workspaceDir);
}

/** Add `.neo/` to the repo's exclude file so agent scratch never shows up as a change. */
export function ignoreNeoDir(workspaceDir: string): void {
  const gitDir = path.join(workspaceDir, ".git");
  if (!existsSync(gitDir)) {
    return;
  }
  try {
    const infoDir = path.join(statSync(gitDir).isDirectory() ? gitDir : workspaceDir, "info");
    mkdirSync(infoDir, { recursive: true });
    const file = path.join(infoDir, "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (/^\.neo\/?$/m.test(current)) {
      return;
    }
    const prefix = current && !current.endsWith("\n") ? "\n" : "";
    writeFileSync(file, `${current}${prefix}${NEO_DIR}/\n`);
  } catch {
    // an exclude file we cannot write is not worth failing the run over
  }
}

/** Read the origin remote so the control plane can match this folder to a repo. */
export async function readRepoIdentity(folder: string): Promise<{ repoKey: string; name: string; git: boolean }> {
  const name = deskWorkspaceShortName(folder);
  if (!isGitRepo(folder)) {
    return { repoKey: deskRepoKey({ folder }), name, git: false };
  }
  const remote = await gitOutput(folder, ["remote", "get-url", "origin"]).catch(() => "");
  return { repoKey: deskRepoKey({ remoteUrl: remote, folder }), name, git: true };
}

/** Uncommitted-aware change counts for the folder the agent is working in. */
export async function localWorkspaceDiffStat(folder: string): Promise<{ added: number; removed: number } | null> {
  if (!isGitRepo(folder)) {
    return null;
  }
  const out = await gitOutput(folder, ["diff", "--numstat", "HEAD"]).catch(() => "");
  if (!out) {
    return { added: 0, removed: 0 };
  }
  let added = 0;
  let removed = 0;
  for (const line of out.split("\n")) {
    const [a, r] = line.trim().split(/\s+/);
    added += Number.parseInt(a ?? "", 10) || 0;
    removed += Number.parseInt(r ?? "", 10) || 0;
  }
  return { added, removed };
}

function gitOutput(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(" ")} exited ${code}`));
    });
  });
}
