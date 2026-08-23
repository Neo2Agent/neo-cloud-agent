import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

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
