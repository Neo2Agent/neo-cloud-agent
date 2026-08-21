import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GIT_AUTHOR_NAME = "Neo Cloud Agent";
const GIT_AUTHOR_EMAIL = "neo-cloud-agent@users.noreply.local";

export function isolatedGitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = path.join(tmpdir(), "neo-git-home");
  mkdirSync(home, { recursive: true });
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: process.env.LANG ?? "C.UTF-8",
    USER: process.env.USER ?? "neo",
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: GIT_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: GIT_AUTHOR_EMAIL,
    ...extra,
  };
}

export function runGit(
  cwd: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", "safe.directory=*", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: isolatedGitEnv(options?.env),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`git ${args[0] ?? ""} timed out`));
    }, options?.timeoutMs ?? 30_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export async function gitOk(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await runGit(cwd, args, { env });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} exited ${result.code}`);
  }
  return result.stdout;
}

export function parseGithubRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const match =
    /github\.com[:/](?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?$/i.exec(remoteUrl.trim()) ??
    /^(?:https?:\/\/)?github\.com\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)/i.exec(remoteUrl.trim());
  if (!match?.groups?.owner || !match.groups.repo) {
    return null;
  }
  return { owner: match.groups.owner, repo: match.groups.repo.replace(/\.git$/i, "") };
}
