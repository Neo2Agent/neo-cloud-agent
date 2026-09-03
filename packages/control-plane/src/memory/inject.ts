import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatUserMemory, MEMORY_FILE, MEMORY_RECALL_LIMIT, NEO_DIR } from "@neo-cloud-agent/contracts";
import type { Run } from "@neo-cloud-agent/contracts";
import { workspaceFor } from "../worker-spawn.js";
import { readMem0Info, searchMemories } from "./client.js";

export async function writeRecalledMemory(run: Run): Promise<void> {
  if (!readMem0Info().configured || !run.userId || !run.prompt.trim()) {
    return;
  }
  try {
    const items = await searchMemories({ userId: run.userId, query: run.prompt, limit: MEMORY_RECALL_LIMIT });
    const text = formatUserMemory(items);
    if (!text) {
      return;
    }
    const dest = path.join(workspaceFor(run.id), NEO_DIR);
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, MEMORY_FILE), text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "mem0_search_failed";
    console.warn(`mem0: skip inject run=${run.id} ${message}`);
  }
}
