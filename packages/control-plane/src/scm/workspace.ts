import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP = new Set(["node_modules", ".git", "dist", ".pnpm-store", ".neo"]);

export type RepoRef = {
  raw: string;
  kind: "remote" | "local";
  source: string;
  name: string;
};

export function repoName(input: string): string {
  const cleaned = input.replace(/\/+$/, "").replace(/\.git$/i, "");
  const base = cleaned.split("/").filter(Boolean).pop() ?? "repo";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-") || "repo";
}

/** Resolve a UI/API repo string to a local directory or a git remote. */
export function resolveRepoRef(raw: string, root: string): RepoRef {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("repo url is empty");
  }

  if (trimmed.startsWith("file://")) {
    const source = fileURLToPath(trimmed);
    return { raw: trimmed, kind: "local", source, name: repoName(source) };
  }

  if (trimmed.startsWith("git@") || trimmed.startsWith("ssh://")) {
    return { raw: trimmed, kind: "remote", source: trimmed, name: repoName(trimmed) };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { raw: trimmed, kind: "remote", source: trimmed, name: repoName(trimmed) };
  }

  if (/^(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+/i.test(trimmed)) {
    const url = `https://${trimmed.replace(/\.git$/i, "")}.git`;
    return { raw: trimmed, kind: "remote", source: url, name: repoName(trimmed) };
  }

  const source = path.isAbsolute(trimmed) ? trimmed : path.resolve(root, trimmed);
  return { raw: trimmed, kind: "local", source, name: repoName(source) };
}

export function gitClone(url: string, dest: string, timeoutMs = 60_000): Promise<void> {
  if (existsSync(dest)) {
    if (readdirSync(dest).length > 0) {
      throw new Error(`clone destination is not empty: ${dest}`);
    }
    rmdirSync(dest);
  }
  mkdirSync(path.dirname(dest), { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", "--depth", "1", url, dest], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("git clone timed out"));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `git clone exited ${code}`));
    });
  });
}

async function copyLocal(src: string, dest: string): Promise<void> {
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new Error(`local repo not found: ${src}`);
  }
  mkdirSync(dest, { recursive: true });
  const filter = (from: string) => !SKIP.has(path.basename(from));
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    await cp(path.join(src, entry.name), path.join(dest, entry.name), { recursive: true, filter });
  }
}

export async function materializeRepos(
  repoUrls: string[],
  workspaceDir: string,
  root: string,
): Promise<Array<{ dest: string; ref: RepoRef }>> {
  mkdirSync(workspaceDir, { recursive: true });
  const refs = repoUrls.map((item) => resolveRepoRef(item, root));
  const placed: Array<{ dest: string; ref: RepoRef }> = [];

  for (const ref of refs) {
    const dest = refs.length === 1 ? workspaceDir : path.join(workspaceDir, ref.name);
    if (ref.kind === "remote") {
      await gitClone(ref.source, dest);
    } else {
      await copyLocal(ref.source, dest);
    }
    placed.push({ dest, ref });
  }
  return placed;
}
