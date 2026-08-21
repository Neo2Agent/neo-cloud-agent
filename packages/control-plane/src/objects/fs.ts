import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
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

export function createFsObjectStore(runsDir: string): ObjectStore {
  const root = path.join(runsDir, ".objects");
  const resolve = (key: string) => {
    const relative = key.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!relative || relative.includes("..")) {
      throw new Error(`invalid object key: ${key}`);
    }
    const dest = path.resolve(root, relative);
    if (dest !== path.resolve(root) && !dest.startsWith(path.resolve(root) + path.sep)) {
      throw new Error(`invalid object key: ${key}`);
    }
    return dest;
  };

  return {
    kind: "fs",
    async put(key, body) {
      const dest = resolve(key);
      mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, dest);
    },
    async get(key) {
      try {
        return readFileSync(resolve(key), "utf8");
      } catch {
        return null;
      }
    },
    async list(prefix) {
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
    },
  };
}
