export {
  filterRuns,
  folderKindLabel,
  groupRuns,
  groupSidebarRuns,
  isShelvedRun,
  runKindLabel,
  runRepoKey,
  runRepoLabel,
  runRepoSource,
  splitShelvedRuns,
  type SidebarFolder,
} from "@neo-cloud-agent/contracts/sidebar-runs";

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
