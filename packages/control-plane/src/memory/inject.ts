import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  formatUserMemory,
  MEMORY_FILE,
  MEMORY_SEARCH_FETCH,
  NEO_DIR,
  selectRecalledMemories,
  type Run,
} from "@neo-cloud-agent/contracts";
import { getUserMemorySettings } from "../accounts/accounts.js";
import { workspaceFor } from "../worker-spawn.js";
import { readMem0Info, searchMemories } from "./client.js";
import { applyMemoryFlags } from "./flags.js";

function writeNeoFile(runId: string, fileName: string, text: string): void {
  const dest = path.join(workspaceFor(runId), NEO_DIR);
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, fileName), text);
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

const LEGACY_USER_MD_FILE = "USER.md";

/** Persisted slots may still have `.neo/USER.md` from the removed rules layer. */
function clearLegacyUserMd(runId: string): void {
  try {
    unlinkSync(path.join(workspaceFor(runId), NEO_DIR, LEGACY_USER_MD_FILE));
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }
    const message = error instanceof Error ? error.message : "unlink_failed";
    console.warn(`memory: skip clear USER.md run=${runId} ${message}`);
  }
}

export async function writeRecalledMemory(run: Run): Promise<void> {
  if (!run.userId) {
    return;
  }
  clearLegacyUserMd(run.id);
  try {
    const settings = await getUserMemorySettings(run.userId);
    if (!settings.enabled || !readMem0Info().configured) {
      return;
    }
    if (!run.prompt.trim()) {
      return;
    }
    const candidates = applyMemoryFlags(
      run.userId,
      await searchMemories({ userId: run.userId, query: run.prompt, limit: MEMORY_SEARCH_FETCH }),
    );
    const text = formatUserMemory(selectRecalledMemories(candidates));
    if (!text) {
      return;
    }
    writeNeoFile(run.id, MEMORY_FILE, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "mem0_search_failed";
    console.warn(`mem0: skip inject run=${run.id} ${message}`);
  }
}
