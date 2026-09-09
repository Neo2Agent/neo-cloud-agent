import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { controlStateDir } from "../store/persist.js";

const sessions = new Map<string, Record<string, unknown>>();
let loaded = false;

function filePath(): string {
  return path.join(controlStateDir(), "loop-sessions.json");
}

function hydrate(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as Record<string, Record<string, unknown>>;
    for (const [runId, state] of Object.entries(parsed)) {
      if (state && typeof state === "object") {
        sessions.set(runId, state);
      }
    }
  } catch {
    // first boot
  }
}

function persist(): void {
  mkdirSync(path.dirname(filePath()), { recursive: true });
  writeFileSync(filePath(), JSON.stringify(Object.fromEntries(sessions), null, 2));
}

export function saveLoopSession(runId: string, state: Record<string, unknown>): void {
  hydrate();
  sessions.set(runId, state);
  persist();
}

export function loadLoopSession(runId: string): Record<string, unknown> | undefined {
  hydrate();
  return sessions.get(runId);
}

export function resetLoopSessionsForTest(): void {
  sessions.clear();
  loaded = false;
}
