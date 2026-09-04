import { MEMORY_SNIPPET_LENGTH } from "@neo-cloud-agent/contracts/memory";

export const CATALOG_PAGE_SIZE = 12;

export function filterByQuery<T>(
  items: T[],
  query: string,
  fields: (item: T) => Array<string | undefined | null>,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    fields(item).some((value) => (value ?? "").toLowerCase().includes(q)),
  );
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

export function snippet(text: string | undefined | null, max = MEMORY_SNIPPET_LENGTH): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function formatShortDate(iso: string | undefined | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function avatarTone(name: string): number {
  let n = 0;
  for (const ch of name) n = (n + ch.charCodeAt(0)) % 5;
  return n;
}
