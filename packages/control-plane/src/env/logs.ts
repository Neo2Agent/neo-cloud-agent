import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_LOG_BYTES = 4_000;
const MAX_LOG_FILES = 20;

export function readWorkspaceLogTails(workspaceDir: string): Array<{ name: string; content: string }> {
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
    .map((name) => {
      const file = path.join(logDir, name);
      let content = "";
      try {
        const raw = readFileSync(file, "utf8");
        content = raw.length <= MAX_LOG_BYTES ? raw : raw.slice(-MAX_LOG_BYTES);
      } catch {
        content = "";
      }
      return { name, content };
    });
}
