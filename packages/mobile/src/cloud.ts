/**
 * Pure helpers for the cloud surfaces mobile shares with the web chat page:
 * memories, inbox, artifacts and skills. UI-free so both shells can use them.
 */
import type { InboxItem } from "@neo-cloud-agent/contracts/project-message";
import type { PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";

export { filterMemories, memoryHint } from "@neo-cloud-agent/contracts/memory";

/** Matches the web bell: caps at 9+ so the badge stays one glyph wide. */
export function unreadBadge(unread: number): string {
  if (unread <= 0) return "";
  return unread > 9 ? "9+" : String(unread);
}

const INBOX_LABEL: Record<InboxItem["kind"], string> = {
  invite_pending: "待审批",
  invited: "邀请",
  todo_assigned: "任务",
  mention: "提到你",
  transfer: "转交",
};

export function inboxKindLabel(kind: InboxItem["kind"]): string {
  return INBOX_LABEL[kind] ?? "消息";
}

export type InboxTarget = { screen: "chat"; runId: string } | { screen: "projects"; projectId: string } | null;

/** A run beats a project so transfers land in the conversation, like the web bell. */
export function inboxTarget(item: Pick<InboxItem, "runId" | "projectId">): InboxTarget {
  if (item.runId) return { screen: "chat", runId: item.runId };
  if (item.projectId) return { screen: "projects", projectId: item.projectId };
  return null;
}

export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** Only project runs can save an artifact; the control plane answers 400 otherwise. */
export function canSaveArtifact(run: { projectId?: string | null } | null | undefined): boolean {
  return Boolean(run?.projectId);
}

export function saveArtifactHint(run: { projectId?: string | null } | null | undefined): string {
  return canSaveArtifact(run) ? "" : "只有项目对话才能保存到项目。";
}

export function installedPlugins(items: PluginCatalogItem[]): PluginCatalogItem[] {
  return items.filter((item) => item.installed);
}

export function pluginActionLabel(item: Pick<PluginCatalogItem, "installed" | "enabled">): string {
  if (!item.installed) return "安装";
  return item.enabled ? "停用" : "启用";
}

export function filterPlugins(items: PluginCatalogItem[], query: string): PluginCatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(
    (item) => item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle),
  );
}

/** The transcript only pages when the control plane says older messages remain. */
export function canLoadOlder(snapshot: { remaining?: number; nextBefore?: string | null } | null | undefined): boolean {
  return Boolean(snapshot && (snapshot.remaining ?? 0) > 0 && snapshot.nextBefore);
}

export function diagnosticsHint(logs: Array<{ content: string }>): string {
  return logs.some((item) => item.content.trim()) ? "" : "还没有日志。";
}

/** Same set the web sidebar shelves: only these can be deleted. */
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

export function toggleSelected(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}
