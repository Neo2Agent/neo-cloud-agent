import { deskRepoKey } from "@neo-cloud-agent/contracts";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withAskpass } from "./askpass.js";
import { gitOk } from "./git.js";

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

function looksBareGit(dir: string): boolean {
  return (
    existsSync(path.join(dir, "HEAD")) &&
    existsSync(path.join(dir, "objects")) &&
    existsSync(path.join(dir, "refs")) &&
    !existsSync(path.join(dir, ".git"))
  );
}

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
    if (looksBareGit(source) || /\.git$/i.test(source)) {
      return { raw: trimmed, kind: "remote", source, name: repoName(source) };
    }
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

const NEO_OVERLAY_NAMES = new Set([".neo"]);

export const CLONE_DEST_BUSY = "clone destination already has files";

/** Default remote clone budget. Override with NEO_GIT_CLONE_TIMEOUT_MS in tests. */
export const GIT_CLONE_TIMEOUT_MS = 180_000;
export const GIT_CLONE_MAX_ATTEMPTS = 2;
const GIT_CLONE_STDERR_TAIL = 400;
const MS_PER_SECOND = 1000;
const GIT_CLONE_KILL_GRACE_MS = 200;
/** GitHub from Beijing often resets HTTP/2 mid-pack. Force HTTP/1.1. */
export const GIT_CLONE_HTTP_VERSION = "HTTP/1.1";
const TRANSIENT_CLONE_ERROR =
  /Failure when receiving data from the peer|GnuTLS recv error|TLS connection|Couldn't connect to server|Connection reset|Empty reply from server|HTTP\/2 stream/i;

export function gitCloneTimeoutMs(): number {
  const raw = Number(process.env.NEO_GIT_CLONE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : GIT_CLONE_TIMEOUT_MS;
}

export function formatGitCloneTimeoutError(url: string, timeoutMs: number, stderr: string): Error {
  const tail = stderr.trim().slice(-GIT_CLONE_STDERR_TAIL);
  const base = `git clone timed out after ${timeoutMs}ms: ${url}`;
  return new Error(tail ? `${base}\n${tail}` : base);
}

export function formatCloneFailedTitle(message: string, repoUrls: string[]): string {
  const repo = repoUrls[0] ? repoName(repoUrls[0]) : "仓库";
  const timeout = /timed out after (\d+)ms/i.exec(message);
  if (timeout) {
    const seconds = Math.max(1, Math.round(Number(timeout[1]) / MS_PER_SECOND));
    return `仓库克隆超时：${repo}，已等待 ${seconds} 秒。`;
  }
  if (isTransientGitCloneError(message)) {
    return `仓库克隆中断：${repo}，GitHub 连接被重置，请重试。`;
  }
  return `仓库准备失败：${repo}`;
}

/** TLS / peer-reset failures that are worth a second clone attempt. */
export function isTransientGitCloneError(message: string): boolean {
  return TRANSIENT_CLONE_ERROR.test(message);
}

export function gitCloneArgs(url: string, dest: string): string[] {
  return ["-c", `http.version=${GIT_CLONE_HTTP_VERSION}`, "clone", "--depth", "1", url, dest];
}

export function isNeoOverlayOnly(dest: string): boolean {
  if (!existsSync(dest) || !statSync(dest).isDirectory()) {
    return false;
  }
  const names = readdirSync(dest);
  return names.length > 0 && names.every((name) => NEO_OVERLAY_NAMES.has(name));
}

function repoIdentity(url: string): string {
  return deskRepoKey({ remoteUrl: url }) || url.trim().toLowerCase();
}

async function originMatches(dest: string, url: string): Promise<boolean> {
  if (!existsSync(path.join(dest, ".git"))) {
    return false;
  }
  try {
    const origin = await gitOk(dest, ["remote", "get-url", "origin"]);
    const wanted = repoIdentity(url);
    return Boolean(wanted) && repoIdentity(origin) === wanted;
  } catch {
    return false;
  }
}

function destForBoundRepo(workspaceDir: string, refs: RepoRef[], ref: RepoRef): string {
  return refs.length === 1 ? workspaceDir : path.join(workspaceDir, ref.name);
}

async function destMatchesBoundRepo(dest: string, ref: RepoRef): Promise<boolean> {
  if (!existsSync(dest) || !statSync(dest).isDirectory()) {
    return false;
  }
  if (isNeoOverlayOnly(dest)) {
    return false;
  }
  if (ref.kind === "remote") {
    return originMatches(dest, ref.source);
  }
  return readdirSync(dest).some((name) => name !== ".neo");
}

/** True when every bound repo is already checked out at dest. */
export async function workspaceMatchesBoundRepos(
  workspaceDir: string,
  repoUrls: string[],
  root: string,
): Promise<boolean> {
  if (repoUrls.length === 0) {
    return true;
  }
  const refs = repoUrls.map((item) => resolveRepoRef(item, root));
  for (const ref of refs) {
    const dest = destForBoundRepo(workspaceDir, refs, ref);
    if (!(await destMatchesBoundRepo(dest, ref))) {
      return false;
    }
  }
  return true;
}

/** Drop leftover dests that are not the bound repo so rematerialize can clone. */
export async function resetUnboundRepoDests(
  workspaceDir: string,
  repoUrls: string[],
  root: string,
): Promise<void> {
  if (repoUrls.length === 0) {
    return;
  }
  const refs = repoUrls.map((item) => resolveRepoRef(item, root));
  for (const ref of refs) {
    const dest = destForBoundRepo(workspaceDir, refs, ref);
    if (await destMatchesBoundRepo(dest, ref)) {
      continue;
    }
    resetFailedCloneDest(dest);
  }
}

async function cloneIntoEmpty(
  url: string,
  dest: string,
  timeoutMs: number,
  token?: string,
): Promise<void> {
  if (existsSync(dest)) {
    if (readdirSync(dest).length > 0) {
      throw new Error(CLONE_DEST_BUSY);
    }
    rmdirSync(dest);
  }
  mkdirSync(path.dirname(dest), { recursive: true });

  const run = (env?: NodeJS.ProcessEnv) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn("git", gitCloneArgs(url, dest), {
        stdio: ["ignore", "pipe", "pipe"],
        env: env ? { ...process.env, ...env } : undefined,
      });
      let stderr = "";
      child.stdout?.resume();
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), GIT_CLONE_KILL_GRACE_MS).unref();
        reject(formatGitCloneTimeoutError(url, timeoutMs, stderr));
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
        reject(new Error(stderr.trim() || `git clone exited ${code}: ${url}`));
      });
    });

  if (token) {
    await withAskpass(token, (env) => run(env));
    return;
  }
  await run();
}

async function cloneBesideOverlay(url: string, dest: string, timeoutMs: number, token?: string): Promise<void> {
  const tmp = mkdtempSync(path.join(path.dirname(dest), ".neo-clone-"));
  try {
    await cloneIntoEmpty(url, tmp, timeoutMs, token);
    for (const name of readdirSync(tmp)) {
      const from = path.join(tmp, name);
      const to = path.join(dest, name);
      if (name === ".neo" && existsSync(to)) {
        for (const child of readdirSync(from)) {
          const childTo = path.join(to, child);
          if (!existsSync(childTo)) {
            renameSync(path.join(from, child), childTo);
          }
        }
        continue;
      }
      if (existsSync(to)) {
        continue;
      }
      renameSync(from, to);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function resetFailedCloneDest(dest: string): void {
  if (!existsSync(dest)) {
    return;
  }
  if (isNeoOverlayOnly(dest)) {
    return;
  }
  if (existsSync(path.join(dest, ".neo"))) {
    for (const name of readdirSync(dest)) {
      if (name === ".neo") {
        continue;
      }
      rmSync(path.join(dest, name), { recursive: true, force: true });
    }
    return;
  }
  rmSync(dest, { recursive: true, force: true });
}

async function cloneWithRetry(
  url: string,
  dest: string,
  timeoutMs: number,
  token: string | undefined,
  clone: (url: string, dest: string, timeoutMs: number, token?: string) => Promise<void>,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GIT_CLONE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await clone(url, dest, timeoutMs, token);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= GIT_CLONE_MAX_ATTEMPTS) {
        break;
      }
      resetFailedCloneDest(dest);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`git clone failed: ${url}`);
}

export async function gitClone(
  url: string,
  dest: string,
  timeoutMs = gitCloneTimeoutMs(),
  token?: string,
): Promise<void> {
  if (existsSync(dest)) {
    if (!statSync(dest).isDirectory()) {
      throw new Error(CLONE_DEST_BUSY);
    }
    if (readdirSync(dest).length === 0) {
      rmdirSync(dest);
    } else if (await originMatches(dest, url)) {
      return;
    } else if (isNeoOverlayOnly(dest)) {
      await cloneWithRetry(url, dest, timeoutMs, token, cloneBesideOverlay);
      return;
    } else {
      throw new Error(CLONE_DEST_BUSY);
    }
  }
  await cloneWithRetry(url, dest, timeoutMs, token, cloneIntoEmpty);
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
  options?: { token?: string; onProgress?: () => void },
): Promise<Array<{ dest: string; ref: RepoRef }>> {
  mkdirSync(workspaceDir, { recursive: true });
  const refs = repoUrls.map((item) => resolveRepoRef(item, root));
  const placed: Array<{ dest: string; ref: RepoRef }> = [];

  for (const ref of refs) {
    const dest = refs.length === 1 ? workspaceDir : path.join(workspaceDir, ref.name);
    if (ref.kind === "remote") {
      await gitClone(ref.source, dest, gitCloneTimeoutMs(), options?.token);
      options?.onProgress?.();
    } else {
      if (!existsSync(ref.source) || !statSync(ref.source).isDirectory()) {
        throw new Error(
          `local repo not found: ${ref.source}。这是本机文件夹，云端 VM 上没有这份目录。请清空仓库或改成 Git 地址；要改本机文件请用 Desk。`,
        );
      }
      await copyWorkspaceTree(ref.source, dest);
    }
    placed.push({ dest, ref });
  }
  return placed;
}
