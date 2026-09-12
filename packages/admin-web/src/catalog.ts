export const CATALOG_PAGE_SIZE = 12;

export function filterByQuery<T>(
  items: T[],
  query: string,
  fields: (item: T) => Array<string | undefined | null>,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => fields(item).some((value) => (value ?? "").toLowerCase().includes(q)));
}

export function paginate<T>(items: T[], page: number, pageSize = CATALOG_PAGE_SIZE): T[] {
  const start = Math.max(0, (page - 1) * pageSize);
  return items.slice(start, start + pageSize);
}

export function pageCount(total: number, pageSize = CATALOG_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

export function clampPage(page: number, total: number, pageSize = CATALOG_PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return [...trimmed].slice(0, 1).join("").toUpperCase();
}

export function snippet(text: string | undefined | null, max = 72): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function avatarTone(name: string): number {
  let n = 0;
  for (const ch of name) n = (n + ch.charCodeAt(0)) % 5;
  return n;
}

const LIVE_STATUSES = new Set([
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);

export function isLiveStatus(status: string): boolean {
  return LIVE_STATUSES.has(status);
}

export function filterUsersByTab<T extends { status?: string }>(users: T[], tab: string): T[] {
  if (tab === "pending") return users.filter((user) => user.status === "pending");
  if (tab === "active") return users.filter((user) => (user.status ?? "active") === "active");
  if (tab === "disabled") return users.filter((user) => user.status === "disabled");
  return users;
}

export function filterRunsByTab<T extends { status: string }>(runs: T[], tab: string): T[] {
  if (tab === "live") return runs.filter((run) => isLiveStatus(run.status));
  if (tab === "idle") return runs.filter((run) => run.status === "IDLE");
  if (tab === "error") return runs.filter((run) => run.status === "ERROR");
  if (tab === "archived") return runs.filter((run) => run.status === "ARCHIVED" || run.status === "EXPIRED");
  return runs;
}

export function filterExpertsByTab<T extends { enabled: boolean }>(experts: T[], tab: string): T[] {
  if (tab === "enabled") return experts.filter((item) => item.enabled);
  if (tab === "disabled") return experts.filter((item) => !item.enabled);
  return experts;
}

export function defaultUserTab(users: Array<{ status?: string }>): "pending" | "all" {
  return users.some((user) => user.status === "pending") ? "pending" : "all";
}
