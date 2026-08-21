import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SKIP_NAMES = new Set(["auth.json", "models.json"]);

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
