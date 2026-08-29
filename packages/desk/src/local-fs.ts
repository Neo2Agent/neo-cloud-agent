import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LocalEntry = { name: string; path: string; type: "file" | "dir"; size?: number };

export type LocalListing = {
  root: string;
  path: string;
  type: "file" | "dir";
  entries?: LocalEntry[];
  content?: string;
  truncated?: boolean;
};

const MAX_ENTRIES = 500;
const MAX_FILE_BYTES = 256 * 1024;

/** Directories that are noise in a file tree and expensive to walk. */
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "target", ".venv", "__pycache__"]);

/** Resolve a workspace-relative path, refusing anything that climbs out. */
export function resolveInsideRoot(root: string, relative: string): string {
  const base = path.resolve(root);
  const dest = path.resolve(base, relative || ".");
  if (dest !== base && !dest.startsWith(`${base}${path.sep}`)) {
    throw new Error("路径超出了本机工作区");
  }
  return dest;
}

export function listLocalPath(root: string, relative = "", options?: { content?: boolean }): LocalListing {
  const base = path.resolve(root);
  const target = resolveInsideRoot(base, relative);
  const rel = path.relative(base, target).split(path.sep).join("/");
  const stat = statSync(target);
  if (stat.isDirectory()) {
    const entries = readdirSync(target, { withFileTypes: true })
      .filter((item) => !(item.isDirectory() && SKIP_DIRS.has(item.name)))
      .slice(0, MAX_ENTRIES)
      .map((item) => {
        const childRel = rel ? `${rel}/${item.name}` : item.name;
        const entry: LocalEntry = {
          name: item.name,
          path: childRel,
          type: item.isDirectory() ? "dir" : "file",
        };
        if (!item.isDirectory()) {
          try {
            entry.size = statSync(path.join(target, item.name)).size;
          } catch {
            // a file that vanished mid-listing just loses its size
          }
        }
        return entry;
      })
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "dir" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
    return { root: base, path: rel, type: "dir", entries };
  }
  if (!options?.content) {
    return { root: base, path: rel, type: "file" };
  }
  const raw = readFileSync(target);
  const slice = raw.subarray(0, MAX_FILE_BYTES);
  return {
    root: base,
    path: rel,
    type: "file",
    content: slice.toString("utf8"),
    truncated: raw.length > slice.length,
  };
}

export function writeLocalFile(root: string, relative: string, content = ""): { path: string } {
  const name = relative.replace(/\\/g, "/").trim();
  if (!name || name.endsWith("/")) {
    throw new Error("文件名不能为空");
  }
  const dest = resolveInsideRoot(root, name);
  if (existsSync(dest)) {
    throw new Error("文件已存在");
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  return { path: path.relative(path.resolve(root), dest).split(path.sep).join("/") };
}
