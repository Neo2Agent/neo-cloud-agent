/** Default number of local conversations allowed to work at the same time. */
export const DEFAULT_MAX_LOCAL_RUNS = 4;

/** Above this a laptop runs out of RAM before it runs out of conversations. */
export const MAX_LOCAL_RUNS_CEILING = 16;

/** A local run holding a worker, or still spawning one. */
export type ActiveLocalRun = { runId: string; folder: string };

export type AdmissionDecision =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

export const SAME_FOLDER_WARNING =
  "同一个文件夹里已经有一条本机对话在改文件。两个 Agent 会看到彼此未提交的改动，必要时先提交或分开文件夹。";

export function normalizeMaxLocalRuns(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX_LOCAL_RUNS;
  }
  return Math.min(n, MAX_LOCAL_RUNS_CEILING);
}

/**
 * Compare two folders the caller already resolved to absolute paths.
 *
 * This module is imported by the renderer for the settings control, so it cannot
 * reach for `node:path`. Resolving is the Node caller's job. `caseInsensitive`
 * is for macOS and Windows, where two spellings are one directory and therefore
 * one shared checkout.
 */
function sameFolder(left: string, right: string, caseInsensitive: boolean): boolean {
  if (!left || !right) {
    return false;
  }
  const trim = (value: string) => {
    const withoutTrailing = value.replace(/[\\/]+$/, "");
    return caseInsensitive ? withoutTrailing.toLowerCase() : withoutTrailing;
  };
  return trim(left) === trim(right);
}

/**
 * Decide whether one more local worker may start.
 *
 * Two folders share nothing, so they run in parallel. One folder is allowed to
 * hold two agents like Cursor does, because refusing would be stricter than the
 * tool we are matching; the caller warns instead. The only hard stop is the
 * machine-wide count, which exists for RAM and CPU rather than correctness.
 *
 * Pure on purpose: admission is the one decision that must not depend on the
 * network, so everything it needs is passed in.
 */
export function admitLocalRun(input: {
  runId: string;
  folder: string;
  active: ActiveLocalRun[];
  limit: number;
  /** True on filesystems where folder paths are case-insensitive. */
  caseInsensitivePaths?: boolean;
}): AdmissionDecision {
  const others = input.active.filter((item) => item.runId !== input.runId);
  const limit = normalizeMaxLocalRuns(input.limit);
  if (others.length >= limit) {
    return {
      ok: false,
      reason: `这台电脑同时最多跑 ${limit} 条本机对话。等一条结束，或在设置里把上限调高。`,
    };
  }
  const insensitive = input.caseInsensitivePaths === true;
  if (others.some((item) => sameFolder(item.folder, input.folder, insensitive))) {
    return { ok: true, warning: SAME_FOLDER_WARNING };
  }
  return { ok: true };
}
