import { getAccountStore } from "../accounts/store.js";
import { getUserMemorySettings, patchUserMemorySettings } from "../accounts/accounts.js";
import { userMemoryEnabled } from "../accounts/types.js";
import { snapshotForRun } from "../events/snapshot.js";
import { listRuns } from "../orchestrator/orchestrator.js";
import { extractIdleRun, extractUserMemories, wasRunExtracted } from "./extract.js";
import { readMem0Info } from "./client.js";

const IDLE_EXTRACT_WINDOW_MS = 2 * 60 * 60 * 1000;
const DIGEST_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const DIGEST_LIMIT = 5;

export function todayStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function extractDueIdleRuns(now = Date.now()): Promise<number> {
  if (!readMem0Info().configured) {
    return 0;
  }
  let count = 0;
  for (const run of listRuns()) {
    if (!run.userId || run.status !== "IDLE" || !run.idleAt || wasRunExtracted(run.id)) {
      continue;
    }
    const idleAt = Date.parse(run.idleAt);
    if (!Number.isFinite(idleAt) || now - idleAt > IDLE_EXTRACT_WINDOW_MS) {
      continue;
    }
    const settings = await getUserMemorySettings(run.userId);
    if (!settings.enabled) {
      continue;
    }
    const saved = await extractIdleRun(run);
    count += saved.length;
  }
  return count;
}

export async function sweepMemoryDigests(now = new Date()): Promise<number> {
  if (!readMem0Info().configured) {
    return 0;
  }
  const stamp = todayStamp(now);
  const since = now.getTime() - DIGEST_LOOKBACK_MS;
  let users = 0;
  for (const user of await getAccountStore().listUsers()) {
    if (!userMemoryEnabled(user) || user.memoryDigestOn === stamp) {
      continue;
    }
    const runs = listRuns().filter(
      (run) =>
        run.userId === user.id &&
        run.status === "IDLE" &&
        run.updatedAt &&
        Date.parse(run.updatedAt) >= since,
    );
    let added = 0;
    for (const run of runs) {
      if (added >= DIGEST_LIMIT) {
        break;
      }
      const saved = await extractUserMemories({
        userId: user.id,
        runId: run.id,
        messages: snapshotForRun(run.id).messages,
        limit: DIGEST_LIMIT - added,
      });
      added += saved.length;
    }
    await patchUserMemorySettings(user.id, { memoryDigestOn: stamp });
    users += 1;
  }
  return users;
}
