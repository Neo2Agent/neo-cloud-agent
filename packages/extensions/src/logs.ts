import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_LOG_BYTES = 4_000;
const MAX_LOG_FILES = 20;

export function readWorkspaceLogs(workspaceDir: string): Array<{ name: string; content: string }> {
  const logDir = path.join(workspaceDir, ".neo", "logs");
  if (!existsSync(logDir) || !statSync(logDir).isDirectory()) {
    return [];
  }
  return readdirSync(logDir)
    .filter((name) => {
      try {
        return statSync(path.join(logDir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort()
    .slice(0, MAX_LOG_FILES)
    .map((name) => ({
      name,
      content: tailFile(path.join(logDir, name), MAX_LOG_BYTES),
    }));
}

export function tailFile(file: string, maxBytes: number): string {
  try {
    const raw = readFileSync(file, "utf8");
    return raw.length <= maxBytes ? raw : raw.slice(-maxBytes);
  } catch {
    return "";
  }
}
