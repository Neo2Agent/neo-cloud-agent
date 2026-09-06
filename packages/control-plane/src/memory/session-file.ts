import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appendSessionMemoryLine, NEO_DIR, SESSION_MEMORY_FILE } from "@neo-cloud-agent/contracts";
import { workspaceFor } from "../worker-spawn.js";

export function appendRunSessionMemory(runId: string, text: string): void {
  const line = text.trim();
  if (!line) {
    return;
  }
  const dest = path.join(workspaceFor(runId), NEO_DIR);
  mkdirSync(dest, { recursive: true });
  const file = path.join(dest, SESSION_MEMORY_FILE);
  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    existing = "";
  }
  writeFileSync(file, appendSessionMemoryLine(existing, line));
}
