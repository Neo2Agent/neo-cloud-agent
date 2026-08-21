import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_NAMES = new Set(["node_modules", "dist", ".pnpm-store", ".control", ".builds", ".warm", ".firecracker"]);

/** Copy `.neo/environment.json`, but never copy run workspaces or caches. */
export function skipCopy(from: string, root?: string): boolean {
  const rel = root ? path.relative(root, from) : from;
  if (root && (rel.startsWith("..") || path.isAbsolute(rel))) {
    return true;
  }
  const parts = rel.split(path.sep);
  if (parts.some((part) => SKIP_NAMES.has(part))) {
    return true;
  }
  const neo = parts.lastIndexOf(".neo");
  return neo >= 0 && (parts[neo + 1] === "runs" || parts[neo + 1] === "firecracker" || parts[neo + 1] === "vms");
}

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

export async function copyWorkspaceTree(src: string, dest: string): Promise<void> {
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new Error(`local repo not found: ${src}`);
  }
  mkdirSync(dest, { recursive: true });
  const filter = (from: string) => !skipCopy(from, src);
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    if (skipCopy(from, src)) {
      continue;
    }
    await cp(from, path.join(dest, entry.name), { recursive: true, filter });
  }
}

/** Copy a captured snapshot as-is (install output included). No skipCopy filter. */
export async function copyTreeAll(src: string, dest: string): Promise<void> {
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new Error(`local repo not found: ${src}`);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
}

/** Copy children of a mounted VM slot back onto the host run dir. */
export async function persistWorkspaceTree(src: string, dest: string): Promise<void> {
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    return;
  }
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "lost+found") {
      continue;
    }
    await cp(path.join(src, entry.name), path.join(dest, entry.name), { recursive: true, force: true });
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
      await copyWorkspaceTree(ref.source, dest);
    }
    placed.push({ dest, ref });
  }
  return placed;
}
