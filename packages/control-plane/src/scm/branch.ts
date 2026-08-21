import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gitOk, runGit } from "./git.js";

const DEFAULT_GITIGNORE = `# added by neo-cloud-agent when the workspace had no .gitignore
.env
.env.*
!.env.example
node_modules/
.neo/runs/
.neo/logs/
.neo-installed
.neo-started
.neo-terminal
`;

export function branchSlug(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || "task";
}

export function runBranchName(runId: string, prompt: string): string {
  return `neo/${branchSlug(prompt)}-${runId.slice(0, 8)}`;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout === "true";
}

export async function currentBranch(cwd: string): Promise<string> {
  const name = await gitOk(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return name || "main";
}

export async function ensureLocalGitIdentity(cwd: string): Promise<void> {
  await gitOk(cwd, ["config", "--local", "user.name", "Neo Cloud Agent"]);
  await gitOk(cwd, ["config", "--local", "user.email", "neo-cloud-agent@users.noreply.local"]);
  await gitOk(cwd, ["config", "--local", "credential.helper", ""]);
}

export async function initWorkspaceRepo(cwd: string): Promise<void> {
  await gitOk(cwd, ["init", "-b", "main"]);
  const ignore = path.join(cwd, ".gitignore");
  if (!existsSync(ignore)) {
    writeFileSync(ignore, DEFAULT_GITIGNORE);
  }
  await ensureLocalGitIdentity(cwd);
  await gitOk(cwd, ["add", "-A"]);
  const status = await gitOk(cwd, ["status", "--porcelain"]);
  if (status) {
    await gitOk(cwd, ["commit", "-m", "chore: import workspace"]);
  } else {
    await gitOk(cwd, ["commit", "--allow-empty", "-m", "chore: import workspace"]);
  }
}

export async function prepareWorkspaceRepo(
  cwd: string,
  input: { runId: string; prompt: string },
): Promise<{ cwd: string; branch: string; baseBranch: string }> {
  if (!(await isGitRepo(cwd))) {
    await initWorkspaceRepo(cwd);
  } else {
    await ensureLocalGitIdentity(cwd);
  }
  const baseBranch = await currentBranch(cwd);
  const branch = runBranchName(input.runId, input.prompt);
  const existing = await runGit(cwd, ["rev-parse", "--verify", branch]);
  if (existing.code === 0) {
    await gitOk(cwd, ["checkout", branch]);
  } else {
    await gitOk(cwd, ["checkout", "-b", branch]);
  }
  return { cwd, branch, baseBranch: baseBranch === "HEAD" ? "main" : baseBranch };
}

export function gitConfigHasSecret(cwd: string, secret: string): boolean {
  try {
    const config = readFileSync(path.join(cwd, ".git/config"), "utf8");
    return Boolean(secret) && config.includes(secret);
  } catch {
    return false;
  }
}
