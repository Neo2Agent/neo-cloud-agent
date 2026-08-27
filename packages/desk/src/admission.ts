import path from "node:path";

/** Default number of local conversations allowed to work at the same time. */
export const DEFAULT_MAX_LOCAL_RUNS = 4;
const MAX_LOCAL_RUNS_CEILING = 16;

/** A local run holding a worker, or still spawning one. */
export type ActiveLocalRun = { runId: string; folder: string };

export type AdmissionDecision =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

export function normalizeMaxLocalRuns(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX_LOCAL_RUNS;
  }
  return Math.min(n, MAX_LOCAL_RUNS_CEILING);
}

function sameFolder(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return path.resolve(left) === path.resolve(right);
}

/**
 * Decide whether one more local worker may start.
 *
 * Two folders share nothing, so they run in parallel. One folder is allowed to
 * hold two agents like Cursor does, because refusing would be stricter than the
 * tool we are matching; the caller warns instead. The only hard stop is the
 * machine-wide count, which exists for RAM and CPU rather than correctness.
 */
export function admitLocalRun(input: {
  runId: string;
  folder: string;
  active: ActiveLocalRun[];
  limit: number;
}): AdmissionDecision {
  const others = input.active.filter((item) => item.runId !== input.runId);
  const limit = normalizeMaxLocalRuns(input.limit);
  if (others.length >= limit) {
    return {
      ok: false,
      reason: `这台电脑同时最多跑 ${limit} 条本机对话。等一条结束，或在设置里把上限调高。`,
    };
  }
  if (others.some((item) => sameFolder(item.folder, input.folder))) {
    return {
      ok: true,
      warning: "同一个文件夹里已经有一条本机对话在改文件。两个 Agent 会看到彼此未提交的改动，必要时先提交或分开文件夹。",
    };
  }
  return { ok: true };
}
