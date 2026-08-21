import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SKIP_NAMES = new Set(["auth.json", "models.json"]);

function safeSessionPath(root: string, name: string): string | null {
  const relative = name.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative || relative.includes("..")) {
    return null;
  }
  const base = path.basename(relative);
  if (SKIP_NAMES.has(base)) {
    return null;
  }
  if (!base.endsWith(".jsonl") && !base.endsWith(".json")) {
    return null;
  }
  const dest = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (dest !== resolvedRoot && !dest.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return dest;
}

export function collectSessionFiles(sessionDir: string): Array<{ name: string; content: string }> {
  if (!existsSync(sessionDir) || !statSync(sessionDir).isDirectory()) {
    return [];
  }
  const files: Array<{ name: string; content: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (SKIP_NAMES.has(entry.name)) {
        continue;
      }
      if (!entry.name.endsWith(".jsonl") && !entry.name.endsWith(".json")) {
        continue;
      }
      files.push({
        name: path.relative(sessionDir, full).replaceAll(path.sep, "/"),
        content: readFileSync(full, "utf8").slice(0, 1_000_000),
      });
    }
  };
  walk(sessionDir);
  return files;
}

export function restoreSessionFiles(
  sessionDir: string,
  files: Array<{ name: string; content: string }>,
): Array<{ name: string; bytes: number }> {
  mkdirSync(sessionDir, { recursive: true });
  const restored: Array<{ name: string; bytes: number }> = [];
  for (const file of files) {
    const dest = safeSessionPath(sessionDir, file.name);
    if (!dest) {
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    const content = file.content.slice(0, 1_000_000);
    writeFileSync(dest, content);
    restored.push({
      name: path.relative(sessionDir, dest).replaceAll(path.sep, "/"),
      bytes: Buffer.byteLength(content),
    });
  }
  return restored;
}
