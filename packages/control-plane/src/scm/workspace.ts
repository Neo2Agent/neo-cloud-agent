import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_NAMES = new Set(["node_modules", "dist", ".pnpm-store", ".control", ".builds", ".warm", ".firecracker"]);

/** Caches and slot leftovers. User source, `.git`, and `.neo` stay. */
export const DURABLE_SKIP_NAMES = new Set([
  "lost+found",
  "node_modules",
  "dist",
  ".pnpm-store",
  ".builds",
  ".warm",
  ".firecracker",
]);

export function skipDurablePersist(from: string, root?: string): boolean {
  const rel = root ? path.relative(root, from) : from;
  if (root && (rel.startsWith("..") || path.isAbsolute(rel))) {
    return true;
  }
  return rel.split(path.sep).some((part) => DURABLE_SKIP_NAMES.has(part));
}

export function measureWorkspaceBytes(root: string): number {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return 0;
  }
  let total = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (DURABLE_SKIP_NAMES.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      try {
        const st = lstatSync(full);
        if (st.isSymbolicLink()) {
          continue;
        }
        if (st.isDirectory()) {
          walk(full);
        } else if (st.isFile()) {
          total += st.size;
        }
      } catch {
        // file disappeared mid-walk
      }
    }
  };
  walk(root);
  return total;
}

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

/** Persist user-visible files. Skip caches. Mirror dest so stale files disappear. */
export async function persistDurableWorkspace(src: string, dest: string): Promise<void> {
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new Error(`workspace source missing: ${src}`);
  }
  mkdirSync(dest, { recursive: true });
  const keep = new Set<string>();
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skipDurablePersist(entry.name)) {
      continue;
    }
    keep.add(entry.name);
    const from = path.join(src, entry.name);
    await cp(from, path.join(dest, entry.name), {
      recursive: true,
      force: true,
      filter: (fromPath) => !skipDurablePersist(fromPath, src),
    });
  }
  for (const entry of readdirSync(dest)) {
    if (keep.has(entry)) {
      continue;
    }
    rmSync(path.join(dest, entry), { recursive: true, force: true });
  }
}

/** Copy a previously persisted host tree onto a fresh slot. */
export async function restoreDurableWorkspace(src: string, dest: string): Promise<boolean> {
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    return false;
  }
  if (path.resolve(src) === path.resolve(dest)) {
    return true;
  }
  const names = readdirSync(src).filter((name) => !skipDurablePersist(name));
  if (names.length === 0) {
    return false;
  }
  await persistWorkspaceTree(src, dest);
  return true;
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
