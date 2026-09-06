import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  formatUserMemory,
  formatUserRules,
  MEMORY_FILE,
  MEMORY_SEARCH_FETCH,
  NEO_DIR,
  selectRecalledMemories,
  USER_RULES_FILE,
  type MemoryItem,
  type Run,
} from "@neo-cloud-agent/contracts";
import { getUserMemorySettings } from "../accounts/accounts.js";
import { workspaceFor } from "../worker-spawn.js";
import { listMemories, readMem0Info, searchMemories } from "./client.js";
import { applyMemoryFlags } from "./flags.js";

function writeNeoFile(runId: string, fileName: string, text: string): void {
  const dest = path.join(workspaceFor(runId), NEO_DIR);
  mkdirSync(dest, { recursive: true });
  writeFileSync(path.join(dest, fileName), text);
}

export async function writeUserRules(run: Run): Promise<void> {
  if (!run.userId) {
    return;
  }
  try {
    const settings = await getUserMemorySettings(run.userId);
    const text = formatUserRules(settings.userRules);
    if (!text) {
      return;
    }
    writeNeoFile(run.id, USER_RULES_FILE, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "user_rules_failed";
    console.warn(`memory: skip USER.md run=${run.id} ${message}`);
  }
}

export async function writeRecalledMemory(run: Run): Promise<void> {
  if (!run.userId) {
    return;
  }
  try {
    const settings = await getUserMemorySettings(run.userId);
    if (!settings.enabled || !readMem0Info().configured) {
      return;
    }
    let pinned: MemoryItem[] = [];
    try {
      pinned = applyMemoryFlags(run.userId, await listMemories(run.userId, MEMORY_SEARCH_FETCH));
    } catch (error) {
      const message = error instanceof Error ? error.message : "mem0_list_failed";
      console.warn(`mem0: skip pinned list run=${run.id} ${message}`);
    }
    let candidates: MemoryItem[] = [];
    if (run.prompt.trim()) {
      candidates = applyMemoryFlags(
        run.userId,
        await searchMemories({ userId: run.userId, query: run.prompt, limit: MEMORY_SEARCH_FETCH }),
      );
    }
    const selected = selectRecalledMemories({ candidates, pinned });
    const text = formatUserMemory([...selected.pinned, ...selected.relevant]);
    if (!text) {
      return;
    }
    writeNeoFile(run.id, MEMORY_FILE, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "mem0_search_failed";
    console.warn(`mem0: skip inject run=${run.id} ${message}`);
  }
}
