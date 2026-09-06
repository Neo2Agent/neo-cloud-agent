import { getUserMemorySettings } from "../accounts/accounts.js";
import { listRuns } from "../orchestrator/orchestrator.js";
import { readMem0Info } from "./client.js";
import { extractIdleRun, wasRunExtracted } from "./extract.js";

/** Scan cadence. LLM extract still runs at most once per conversation. */
export const MEMORY_EXTRACT_TICK_MS = 5 * 60 * 1000;
/** Ignore brief pauses so a mid-turn gap does not extract. */
export const IDLE_SETTLE_MS = 10 * 60 * 1000;
/** Still pick up idle conversations after a process restart. */
export const IDLE_LOOKBACK_MS = 36 * 60 * 60 * 1000;

export type IdleExtractRun = {
  id: string;
  userId?: string | null;
  status?: string;
  idleAt?: string | null;
};

export function isIdleRunDueForExtract(
  run: IdleExtractRun,
  now: number,
  extracted: (runId: string) => boolean = wasRunExtracted,
): boolean {
  if (!run.userId || run.status !== "IDLE" || !run.idleAt || extracted(run.id)) {
    return false;
  }
  const idleAt = Date.parse(run.idleAt);
  if (!Number.isFinite(idleAt)) {
    return false;
  }
  const idleForMs = now - idleAt;
  return idleForMs >= IDLE_SETTLE_MS && idleForMs <= IDLE_LOOKBACK_MS;
}

export async function extractDueIdleRuns(now = Date.now()): Promise<number> {
  if (!readMem0Info().configured) {
    return 0;
  }
  let count = 0;
  for (const run of listRuns()) {
    const userId = run.userId;
    if (!userId || !isIdleRunDueForExtract(run, now)) {
      continue;
    }
    const settings = await getUserMemorySettings(userId);
    if (!settings.enabled) {
      continue;
    }
    const saved = await extractIdleRun(run);
    count += saved.length;
  }
  return count;
}
