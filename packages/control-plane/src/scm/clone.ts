import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { DiskCloneResult } from "@neo-cloud-agent/contracts";
import { copyTreeAll } from "./workspace.js";

export type TryReflink = (src: string, dest: string) => Promise<boolean>;

let tryReflinkImpl: TryReflink = defaultTryReflink;

/** Test hook. Overlayfs hosts reject `cp --reflink=always`; inject success/failure. */
export function setTryReflinkForTests(fn?: TryReflink): void {
  tryReflinkImpl = fn ?? defaultTryReflink;
}

export async function tryReflinkPath(src: string, dest: string): Promise<boolean> {
  return tryReflinkImpl(src, dest);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function defaultTryReflink(src: string, dest: string): Promise<boolean> {
  if (!existsSync(src) || samePath(src, dest)) {
    return Promise.resolve(false);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  return new Promise((resolve) => {
    const child = spawn("cp", ["-a", "--reflink=always", "--", src, dest], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (!ok && existsSync(dest) && !samePath(src, dest)) {
        rmSync(dest, { recursive: true, force: true });
      }
      resolve(ok && existsSync(dest));
    };
    child.on("error", () => finish(false));
    child.on("exit", (code) => finish(code === 0));
  });
}

/**
 * Materialize an already-captured Build snapshot.
 * Prefer CoW (`cp --reflink=always`); fall back to a full tree copy.
 */
export async function materializeSnapshot(src: string, dest: string): Promise<DiskCloneResult> {
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    throw new Error(`local repo not found: ${src}`);
  }
  if (samePath(src, dest)) {
    return { method: "shared", dest, kind: "workspace" };
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  if (await tryReflinkPath(src, dest)) {
    return { method: "reflink", dest, kind: "workspace" };
  }
  await copyTreeAll(src, dest);
  return { method: "copy", dest, kind: "workspace" };
}

/**
 * Materialize a Firecracker rootfs file.
 * Prefer CoW; if the filesystem cannot reflink, share the original read-only image.
 * Never full-copy a production rootfs (~1.5GiB) on fallback.
 */
export async function materializeDiskImage(src: string, dest: string): Promise<DiskCloneResult> {
  if (!existsSync(src) || !statSync(src).isFile()) {
    throw new Error(`disk image not found: ${src}`);
  }
  if (samePath(src, dest)) {
    return { method: "shared", dest: src, kind: "rootfs" };
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    rmSync(dest, { force: true });
  }
  if (await tryReflinkPath(src, dest)) {
    return { method: "reflink", dest, kind: "rootfs" };
  }
  if (existsSync(dest)) {
    rmSync(dest, { force: true });
  }
  return { method: "shared", dest: src, kind: "rootfs" };
}
