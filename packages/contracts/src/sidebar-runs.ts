import { deskRepoKey } from "./desk-workspace.js";
import { repoShortLabel } from "./repo-label.js";

const ACTIVE_RUN_STATUSES = [
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
] as const;

const SHELVED_RUN_STATUSES = new Set(["ARCHIVED", "EXPIRED"]);

export function groupRuns<T extends { id: string; status: string; createdAt: string }>(
  runs: T[],
  pinned: string[],
): { pinned: T[]; active: T[]; recent: T[] } {
  const pinSet = new Set(pinned);
  const pinnedRuns = pinned.map((id) => runs.find((run) => run.id === id)).filter((item): item is T => Boolean(item));
  const rest = runs
    .filter((run) => !pinSet.has(run.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const active = rest.filter((run) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status));
  const recent = rest.filter((run) => !active.includes(run));
  return { pinned: pinnedRuns, active, recent };
}

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

export function isShelvedRun(status: string): boolean {
  return SHELVED_RUN_STATUSES.has(status);
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

export function folderKindLabel<T extends { projectId?: string | null; repoUrls?: string[] | null }>(
  items: T[],
): "办公" | "代码" | null {
  if (items.length === 0 || !items.some((item) => item.projectId)) return null;
  return items.some((item) => (item.repoUrls?.length ?? 0) > 0) ? "代码" : "办公";
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
    active: items.filter((run) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)),
    recent: items.filter((run) => !(ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)),
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
      active: chatItems.filter((run) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)),
      recent: chatItems.filter((run) => !(ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)),
    },
  };
}
