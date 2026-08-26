import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { DeskAssignment } from "@neo-cloud-agent/contracts";

export function isGitRepo(folder: string): boolean {
  return existsSync(path.join(folder, ".git"));
}

export async function prepareDeskWorkspace(input: {
  repoDir: string;
  runId: string;
}): Promise<string> {
  if (!isGitRepo(input.repoDir)) {
    throw new Error("本机执行只允许 git 仓库文件夹");
  }
  const dest = path.join(input.repoDir, ".neo", "worktrees", input.runId.slice(0, 8));
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    return dest;
  }
  const branch = `neo/desk-${input.runId.slice(0, 8)}`;
  await runGit(input.repoDir, ["worktree", "add", "-b", branch, dest]);
  return dest;
}

export function writeRunBootstrap(
  workspaceDir: string,
  bootstrap: Record<string, unknown>,
): void {
  const dest = path.join(workspaceDir, ".neo");
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, "run-bootstrap.json"), `${JSON.stringify(bootstrap, null, 2)}\n`);
}

export function writeRunExpertFiles(
  workspaceDir: string,
  assignment: Pick<DeskAssignment, "expertMarkdown" | "expertTeamMarkdown" | "expertMeta" | "expertAgents">,
): void {
  if (!assignment.expertMeta && !assignment.expertMarkdown && !assignment.expertTeamMarkdown && !assignment.expertAgents?.length) {
    return;
  }
  const dest = path.join(workspaceDir, ".neo");
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
    const agentsDir = path.join(dest, "agents");
    mkdirSync(agentsDir, { recursive: true });
    for (const agent of assignment.expertAgents) {
      writeFileSync(path.join(agentsDir, `${agent.slug}.md`), agent.markdown);
    }
  }
}

function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(" ")} exited ${code}`));
    });
  });
}
