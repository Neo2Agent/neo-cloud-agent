const KEY = "neo.pinnedRuns";

export function readPinnedRuns(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writePinnedRuns(ids: string[], storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(KEY, JSON.stringify([...new Set(ids)]));
}

export function togglePinnedRun(id: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string[] {
  const current = readPinnedRuns(storage);
  const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current];
  writePinnedRuns(next, storage);
  return next;
}

export function groupRuns<T extends { id: string; status: string; createdAt: string }>(
  runs: T[],
  pinned: string[],
): { pinned: T[]; active: T[]; recent: T[] } {
  const pinSet = new Set(pinned);
  const pinnedRuns = pinned.map((id) => runs.find((run) => run.id === id)).filter((item): item is T => Boolean(item));
  const rest = runs
    .filter((run) => !pinSet.has(run.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const active = rest.filter((run) =>
    ["NOT_YET_STARTED", "PROVISIONING", "INSTALLING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"].includes(run.status),
  );
  const recent = rest.filter((run) => !active.includes(run));
  return { pinned: pinnedRuns, active, recent };
}
