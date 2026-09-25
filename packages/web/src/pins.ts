import { deskRepoKey } from "@neo-cloud-agent/contracts";
import { repoShortLabel } from "./repo.js";

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
export function filterRuns<
  T extends { title?: string | null; prompt?: string; id: string; repoUrls?: string[] | null },
>(runs: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return runs;
  return runs.filter((run) => {
    if ((run.title ?? "").toLowerCase().includes(needle)) return true;
    if ((run.prompt ?? "").toLowerCase().includes(needle)) return true;
    if (run.id.toLowerCase().includes(needle)) return true;
    return (run.repoUrls ?? []).some((url) => {
      const text = url.toLowerCase();
      return text.includes(needle) || repoShortLabel(url).toLowerCase().includes(needle);
    });
  });
}

export function runRepoKey(run: { repoUrls?: string[] | null }): string {
  const urls = (run.repoUrls ?? []).map((item) => item.trim()).filter(Boolean);
  if (urls.length === 0) return "";
  const keys = urls
    .map((url) => deskRepoKey({ remoteUrl: url }) || deskRepoKey({ folder: url }))
    .filter(Boolean);
  return [...new Set(keys)].sort().join("|");
}

export function runRepoLabel(run: { repoUrls?: string[] | null }): string {
  const urls = (run.repoUrls ?? []).map((item) => item.trim()).filter(Boolean);
  if (urls.length === 0) return "";
  const first = repoShortLabel(urls[0] ?? "") || urls[0] || "仓库";
  return urls.length > 1 ? `${first} +${urls.length - 1}` : first;
}

export function runRepoSource(run: { repoUrls?: string[] | null }): string {
  return (run.repoUrls ?? []).map((item) => item.trim()).find(Boolean) ?? "";
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

export function runKindLabel(run: { projectId?: string | null; repoUrls?: string[] | null }): "办公" | "代码" | null {
  if (!run.projectId) return null;
  return run.repoUrls && run.repoUrls.length > 0 ? "代码" : "办公";
}

export type SidebarFolder<T> = {
  key: string;
  label: string;
  source?: string;
  active: T[];
  recent: T[];
};

export function groupSidebarRuns<
  T extends { id: string; status: string; createdAt: string; projectId?: string | null; repoUrls?: string[] | null },
>(
  runs: T[],
  pinned: string[],
  projectNames: Record<string, string>,
): {
  pinned: T[];
  folders: SidebarFolder<T>[];
  repos: SidebarFolder<T>[];
  chat: { active: T[]; recent: T[] };
} {
  const { pinned: pinnedRuns, active, recent } = groupRuns(runs, pinned);
  const rest = [...active, ...recent];
  const projectKeys: string[] = [];
  const projectBuckets = new Map<string, T[]>();
  const repoKeys: string[] = [];
  const repoBuckets = new Map<string, T[]>();
  const chatItems: T[] = [];
  for (const run of rest) {
    if (run.projectId) {
      if (!projectBuckets.has(run.projectId)) {
        projectBuckets.set(run.projectId, []);
        projectKeys.push(run.projectId);
      }
      projectBuckets.get(run.projectId)!.push(run);
      continue;
    }
    const repoKey = runRepoKey(run);
    if (repoKey) {
      if (!repoBuckets.has(repoKey)) {
        repoBuckets.set(repoKey, []);
        repoKeys.push(repoKey);
      }
      repoBuckets.get(repoKey)!.push(run);
      continue;
    }
    chatItems.push(run);
  }
  const toFolder = (items: T[], extra: { key: string; label: string; source?: string }): SidebarFolder<T> => ({
    ...extra,
    active: items.filter((run) => ACTIVE.includes(run.status)),
    recent: items.filter((run) => !ACTIVE.includes(run.status)),
  });
  return {
    pinned: pinnedRuns,
    folders: projectKeys.map((key) =>
      toFolder(projectBuckets.get(key) ?? [], { key, label: projectNames[key] || "项目对话" }),
    ),
    repos: repoKeys.map((key) => {
      const items = repoBuckets.get(key) ?? [];
      const sample = items[0];
      return toFolder(items, {
        key,
        label: sample ? runRepoLabel(sample) : key,
        source: sample ? runRepoSource(sample) : "",
      });
    }),
    chat: {
      active: chatItems.filter((run) => ACTIVE.includes(run.status)),
      recent: chatItems.filter((run) => !ACTIVE.includes(run.status)),
    },
  };
}

export function groupRunsByProject<
  T extends { id: string; status: string; createdAt: string; projectId?: string | null; repoUrls?: string[] | null },
>(
  runs: T[],
  pinned: string[],
  projectNames: Record<string, string>,
): {
  pinned: T[];
  folders: SidebarFolder<T>[];
  loose: { active: T[]; recent: T[] };
} {
  const grouped = groupSidebarRuns(runs, pinned, projectNames);
  return { pinned: grouped.pinned, folders: grouped.folders, loose: grouped.chat };
}
