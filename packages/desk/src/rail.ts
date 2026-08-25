export type SpaceKind = "project" | "folder" | "repo";

export type RailPlacement =
  | { section: "inbox" }
  | { section: "space"; kind: SpaceKind; key: string; label: string; projectId?: string };

export type RailRun = {
  id: string;
  projectId?: string | null;
  repoUrls?: string[];
  updatedAt?: string;
};

export type RailSpaceGroup<T extends RailRun = RailRun> = {
  kind: SpaceKind;
  key: string;
  label: string;
  projectId?: string;
  runs: T[];
};

export function lastPathSegment(value: string): string {
  const clean = value.replace(/\/$/, "").replace(/\.git$/, "");
  try {
    if (/^https?:\/\//i.test(clean)) {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return parts.at(-1) || clean;
    }
  } catch {
    /* use path split */
  }
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || clean;
}

export function isLocalPath(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^https?:\/\//i.test(text) || /^git@/i.test(text) || text.endsWith(".git")) return false;
  return text.startsWith("/") || text.startsWith("file:") || /^[A-Za-z]:[\\/]/.test(text);
}

export function railPlacement(run: RailRun, projectName?: string | null): RailPlacement {
  if (run.projectId) {
    return {
      section: "space",
      kind: "project",
      key: `project:${run.projectId}`,
      label: projectName?.trim() || "项目",
      projectId: run.projectId,
    };
  }
  const url = run.repoUrls?.[0]?.trim() ?? "";
  if (!url) return { section: "inbox" };
  if (isLocalPath(url)) {
    return { section: "space", kind: "folder", key: `folder:${url}`, label: lastPathSegment(url) };
  }
  return { section: "space", kind: "repo", key: `repo:${url}`, label: lastPathSegment(url) };
}

function recency(iso?: string): number {
  const ms = iso ? Date.parse(iso) : 0;
  return Number.isFinite(ms) ? ms : 0;
}

export function groupRailSessions<T extends RailRun>(
  runs: T[],
  projectName: (projectId: string) => string | undefined,
): { inbox: T[]; spaces: Array<RailSpaceGroup<T>> } {
  const inbox: T[] = [];
  const spaces = new Map<string, RailSpaceGroup<T>>();
  for (const run of runs) {
    const place = railPlacement(run, run.projectId ? projectName(run.projectId) : undefined);
    if (place.section === "inbox") {
      inbox.push(run);
      continue;
    }
    const current = spaces.get(place.key) ?? {
      kind: place.kind,
      key: place.key,
      label: place.label,
      projectId: place.projectId,
      runs: [],
    };
    current.runs.push(run);
    spaces.set(place.key, current);
  }
  inbox.sort((left, right) => recency(right.updatedAt) - recency(left.updatedAt));
  const grouped = [...spaces.values()].map((group) => ({
    ...group,
    runs: [...group.runs].sort((left, right) => recency(right.updatedAt) - recency(left.updatedAt)),
  }));
  grouped.sort((left, right) => recency(right.runs[0]?.updatedAt) - recency(left.runs[0]?.updatedAt));
  return { inbox, spaces: grouped };
}
