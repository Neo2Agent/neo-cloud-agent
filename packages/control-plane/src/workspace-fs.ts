import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_NAMES = new Set(["node_modules", ".git", "lost+found", ".pnpm-store"]);
const MAX_ENTRIES = 200;
const MAX_FILE_BYTES = 200_000;

export type WorkspaceFsEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
};

export type WorkspaceFsListing = {
  path: string;
  type: "dir" | "file";
  entries?: WorkspaceFsEntry[];
  content?: string;
  truncated?: boolean;
  mediaType?: string;
};

function resolveInside(root: string, rel = ""): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, rel);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error("path escapes workspace");
  }
  return target;
}

export function listWorkspacePath(root: string, rel = "", options?: { content?: boolean }): WorkspaceFsListing {
  const target = resolveInside(root, rel);
  if (!existsSync(target)) {
    throw new Error("path not found");
  }
  const stat = statSync(target);
  const relative = path.relative(path.resolve(root), target).replaceAll("\\", "/") || ".";
  if (stat.isDirectory()) {
    const entries: WorkspaceFsEntry[] = [];
    for (const item of readdirSync(target, { withFileTypes: true })) {
      if (SKIP_NAMES.has(item.name) || item.name.startsWith(".")) {
        if (item.name !== ".neo") {
          continue;
        }
      }
      const child = path.join(target, item.name);
      let childStat;
      try {
        childStat = statSync(child);
      } catch {
        continue;
      }
      entries.push({
        name: item.name,
        path: path.posix.join(relative === "." ? "" : relative, item.name),
        type: childStat.isDirectory() ? "dir" : "file",
        size: childStat.isFile() ? childStat.size : undefined,
      });
      if (entries.length >= MAX_ENTRIES) {
        break;
      }
    }
    entries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "dir" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    return { path: relative, type: "dir", entries };
  }
  if (!stat.isFile()) {
    throw new Error("unsupported path");
  }
  const listing: WorkspaceFsListing = {
    path: relative,
    type: "file",
    mediaType: guessMediaType(target),
  };
  if (options?.content) {
    const buf = readFileSync(target);
    listing.truncated = buf.length > MAX_FILE_BYTES;
    listing.content = buf.subarray(0, MAX_FILE_BYTES).toString("utf8");
  }
  return listing;
}

function guessMediaType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".md") return "text/markdown";
  if (ext === ".json") return "application/json";
  if (ext === ".ts" || ext === ".tsx") return "text/typescript";
  if (ext === ".js" || ext === ".jsx") return "text/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".html") return "text/html";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "text/plain";
}
