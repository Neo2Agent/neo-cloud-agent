import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const SKIP_NAMES = new Set(["auth.json", "models.json"]);

function walkJsonl(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonl(full));
      continue;
    }
    if (SKIP_NAMES.has(entry.name) || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    files.push(full);
  }
  return files;
}

function hasSessionHeader(file: string): boolean {
  try {
    const first = readFileSync(file, "utf8").split("\n").find((line) => line.trim());
    if (!first) {
      return false;
    }
    const parsed = JSON.parse(first) as { type?: string };
    return parsed.type === "session";
  } catch {
    return false;
  }
}

/** Newest pi session JSONL in the restored directory, ignoring cwd in the header. */
export function findResumableSessionFile(sessionDir: string): string | null {
  const files = walkJsonl(sessionDir)
    .filter((file) => hasSessionHeader(file))
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  return files[0]?.file ?? null;
}

export function resumeOrCreateSessionManager(
  cwd: string,
  sessionDir: string,
): { manager: SessionManager; resumed: boolean; file: string | null } {
  const file = findResumableSessionFile(sessionDir);
  if (file) {
    return {
      manager: SessionManager.open(file, sessionDir, cwd),
      resumed: true,
      file,
    };
  }
  return {
    manager: SessionManager.create(cwd, sessionDir),
    resumed: false,
    file: null,
  };
}
