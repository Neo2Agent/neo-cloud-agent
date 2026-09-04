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

const ACTIVE = ["NOT_YET_STARTED", "PROVISIONING", "INSTALLING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"];

export function groupRuns<T extends { id: string; status: string; createdAt: string }>(
  runs: T[],
  pinned: string[],
): { pinned: T[]; active: T[]; recent: T[] } {
  const pinSet = new Set(pinned);
  const pinnedRuns = pinned.map((id) => runs.find((run) => run.id === id)).filter((item): item is T => Boolean(item));
  const rest = runs
    .filter((run) => !pinSet.has(run.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const active = rest.filter((run) => ACTIVE.includes(run.status));
  const recent = rest.filter((run) => !active.includes(run));
  return { pinned: pinnedRuns, active, recent };
}

// Search both fields: a stored title is only the first line, so the rest of the
// prompt must stay findable.
export function filterRuns<T extends { title?: string | null; prompt?: string; id: string }>(runs: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return runs;
  return runs.filter(
    (run) =>
      (run.title ?? "").toLowerCase().includes(needle) ||
      (run.prompt ?? "").toLowerCase().includes(needle) ||
      run.id.toLowerCase().includes(needle),
  );
}

const SHELVED = new Set(["ARCHIVED", "EXPIRED"]);

export function isShelvedRun(status: string): boolean {
  return SHELVED.has(status);
}

export function splitShelvedRuns<T extends { status: string }>(runs: T[]): { live: T[]; shelved: T[] } {
  const live: T[] = [];
  const shelved: T[] = [];
  for (const run of runs) {
    if (isShelvedRun(run.status)) shelved.push(run);
    else live.push(run);
  }
  return { live, shelved };
}

export function groupRunsByProject<T extends { id: string; status: string; createdAt: string; projectId?: string | null }>(
  runs: T[],
  pinned: string[],
  projectNames: Record<string, string>,
): { pinned: T[]; sections: Array<{ key: string; label: string; active: T[]; recent: T[] }> } {
  const { pinned: pinnedRuns, active, recent } = groupRuns(runs, pinned);
  const rest = [...active, ...recent];
  const keys: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const run of rest) {
    const key = run.projectId || "";
    if (!buckets.has(key)) {
      buckets.set(key, []);
      keys.push(key);
    }
    buckets.get(key)!.push(run);
  }
  const sections = keys.map((key) => {
    const items = buckets.get(key) ?? [];
    return {
      key: key || "none",
      label: key ? projectNames[key] || "项目对话" : "未归项目",
      active: items.filter((run) => ACTIVE.includes(run.status)),
      recent: items.filter((run) => !ACTIVE.includes(run.status)),
    };
  });
  return { pinned: pinnedRuns, sections };
}
