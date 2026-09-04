import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ObjectStore } from "./store.js";

function walk(dir: string, prefix: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(full, rel));
      continue;
    }
    out.push(rel.replaceAll(path.sep, "/"));
  }
  return out;
}

export function objectsRoot(runsDir: string): string {
  return path.join(runsDir, ".objects");
}

export function resolveObjectPath(runsDir: string, key: string): string {
  const root = path.resolve(objectsRoot(runsDir));
  const relative = key.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative || relative.includes("..")) {
    throw new Error(`invalid object key: ${key}`);
  }
  const dest = path.resolve(root, relative);
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw new Error(`invalid object key: ${key}`);
  }
  return dest;
}

export function putObjectSync(runsDir: string, key: string, body: string): void {
  const dest = resolveObjectPath(runsDir, key);
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, dest);
}

export function getObjectSync(runsDir: string, key: string): string | null {
  try {
    return readFileSync(resolveObjectPath(runsDir, key), "utf8");
  } catch {
    return null;
  }
}

export function removeObjectSync(runsDir: string, key: string): void {
  try {
    rmSync(resolveObjectPath(runsDir, key), { force: true });
  } catch {
    // ignore missing objects
  }
}

export function listObjectsSync(runsDir: string, prefix: string): string[] {
  const root = objectsRoot(runsDir);
  const relative = prefix.replaceAll("\\", "/").replace(/^\/+/, "");
  const dir = relative ? path.join(root, ...relative.split("/")) : root;
  try {
    if (!statSync(dir).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  return walk(dir, relative).sort();
}

export function removePrefixSync(runsDir: string, prefix: string): string[] {
  const keys = listObjectsSync(runsDir, prefix);
  for (const key of keys) {
    removeObjectSync(runsDir, key);
  }
  return keys;
}

export function createFsObjectStore(runsDir: string): ObjectStore {
  return {
    kind: "fs",
    async put(key, body) {
      putObjectSync(runsDir, key, body);
    },
    async get(key) {
      return getObjectSync(runsDir, key);
    },
    async list(prefix) {
      return listObjectsSync(runsDir, prefix);
    },
  };
}
