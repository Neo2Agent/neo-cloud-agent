import { toolArgPreview } from "./display.js";
import type { TranscriptGroup, TranscriptTool } from "./events.js";

export type DiffLine = { type: "add" | "del" | "ctx"; text: string };
export type ToolChromeKind = "file" | "term" | "link" | "default";

const DIFF_LIMIT = 80;
export const WRITE_PREVIEW_LINES = 12;
export const WORK_GROUP_PREVIEW = 8;

function recordArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function detailsPatch(tool: TranscriptTool): string {
  if (typeof tool.details?.diff === "string") return tool.details.diff;
  if (typeof tool.details?.patch === "string") return tool.details.patch;
  return "";
}

export function parseUnifiedDiff(diff: string, limit = DIFF_LIMIT): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
    if (!line || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ type: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      lines.push({ type: "del", text: line.slice(1) });
    } else {
      lines.push({ type: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
    }
    if (lines.length >= limit) {
      break;
    }
  }
  return lines;
}

export function fileToolDiff(tool: TranscriptTool): { path: string; lines: DiffLine[] } | null {
  const args = recordArgs(tool.args);
  const path = typeof args.path === "string" ? args.path : "";
  const patch = detailsPatch(tool);
  if (patch) {
    const lines = parseUnifiedDiff(patch);
    return lines.length > 0 ? { path, lines } : null;
  }
  if (tool.name === "edit") {
    const edits = Array.isArray(args.edits)
      ? args.edits
      : args.oldText != null || args.newText != null
        ? [{ oldText: args.oldText, newText: args.newText }]
        : [];
    const lines: DiffLine[] = [];
    for (const edit of edits) {
      if (!edit || typeof edit !== "object") continue;
      const rec = edit as Record<string, unknown>;
      if (typeof rec.oldText === "string") {
        for (const line of rec.oldText.split("\n")) {
          lines.push({ type: "del", text: line });
        }
      }
      if (typeof rec.newText === "string") {
        for (const line of rec.newText.split("\n")) {
          lines.push({ type: "add", text: line });
        }
      }
      if (lines.length >= DIFF_LIMIT) break;
    }
    return lines.length > 0 ? { path, lines: lines.slice(0, DIFF_LIMIT) } : null;
  }
  if (tool.name === "write" && typeof args.content === "string") {
    return {
      path,
      lines: args.content.split("\n").slice(0, DIFF_LIMIT).map((text) => ({ type: "add" as const, text })),
    };
  }
  return null;
}

/** A write shows twelve lines until expanded; edits and patches show their diff. */
export function fileCardPreview(
  tool: TranscriptTool,
  options: { full?: boolean } = {},
): { path: string; lines: DiffLine[]; hidden: number } | null {
  const args = recordArgs(tool.args);
  const path = typeof args.path === "string" ? args.path : "";
  if (!detailsPatch(tool) && tool.name === "write" && typeof args.content === "string") {
    const all = args.content.split("\n");
    const shown = options.full ? all : all.slice(0, WRITE_PREVIEW_LINES);
    return {
      path,
      lines: shown.map((text) => ({ type: "add" as const, text })),
      hidden: all.length - shown.length,
    };
  }
  const diff = fileToolDiff(tool);
  if (!diff) return null;
  return { path: diff.path || path, lines: diff.lines, hidden: 0 };
}

function isUsefulLinkPreview(preview: string): boolean {
  const text = preview.trim();
  return Boolean(text) && text !== "{}" && text !== "[]" && !text.startsWith("{") && !text.startsWith("[");
}

const TOOL_VERBS: Record<string, string> = {
  bash: "执行",
  shell: "执行",
  read: "读取",
  edit: "编辑",
  write: "编辑",
  apply_patch: "编辑",
  grep: "搜索",
  search: "搜索",
  glob: "搜索",
  neo_browse: "浏览",
  browse: "浏览",
  neo_subagent: "子任务",
};

export function toolVerb(name: string): string {
  return TOOL_VERBS[name.toLowerCase()] ?? name;
}

export function toolLinkLabel(tool: TranscriptTool): string {
  const preview = toolArgPreview(tool.args);
  if (isUsefulLinkPreview(preview)) return preview;
  const title = typeof tool.details?.title === "string" ? tool.details.title.trim() : "";
  if (title) return title;
  const url = typeof tool.details?.url === "string" ? tool.details.url.trim() : "";
  if (url) return url;
  const output = tool.output ?? "";
  const heading = output.match(/^#\s+(.+)/);
  if (heading?.[1]?.trim()) return heading[1].trim();
  const found = output.match(/https?:\/\/\S+/);
  if (found?.[0]) return found[0];
  return toolVerb(tool.name);
}

export function toolChromeKind(name: string): ToolChromeKind {
  const n = name.toLowerCase();
  if (n === "edit" || n === "write" || n === "apply_patch") return "file";
  if (n === "bash" || n === "shell") return "term";
  if (n === "neo_browse" || n === "browse" || n === "grep" || n === "search" || n === "glob") return "link";
  return "default";
}

export function toolDiffStat(tool: TranscriptTool): { added: number; removed: number } | null {
  const args = recordArgs(tool.args);
  if (!detailsPatch(tool) && tool.name === "write" && typeof args.content === "string") {
    const added = args.content.split("\n").length;
    return added > 0 ? { added, removed: 0 } : null;
  }
  const diff = fileToolDiff(tool);
  if (!diff) return null;
  let added = 0;
  let removed = 0;
  for (const line of diff.lines) {
    if (line.type === "add") added += 1;
    else if (line.type === "del") removed += 1;
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

type ToolBucket = {
  id: string;
  names: readonly string[];
  label: (count: number) => string;
};

const TOOL_BUCKETS: readonly ToolBucket[] = [
  { id: "edit", names: ["edit", "write", "apply_patch"], label: (count) => `编辑 ${count} 个文件` },
  { id: "read", names: ["read"], label: (count) => `读取 ${count} 个文件` },
  { id: "exec", names: ["bash", "shell"], label: (count) => `执行 ${count} 条命令` },
  { id: "search", names: ["grep", "search", "glob"], label: (count) => `搜索 ${count} 次` },
  { id: "browse", names: ["neo_browse", "browse"], label: (count) => `浏览 ${count} 个页面` },
];

export function toolGroupSummary(tools: TranscriptTool[]): string {
  const counts = new Map<string, number>();
  let other = 0;
  let added = 0;
  let removed = 0;
  for (const tool of tools) {
    const bucket = TOOL_BUCKETS.find((item) => item.names.includes(tool.name.toLowerCase()));
    if (bucket) counts.set(bucket.id, (counts.get(bucket.id) ?? 0) + 1);
    else other += 1;
    const stat = toolDiffStat(tool);
    if (!stat) continue;
    added += stat.added;
    removed += stat.removed;
  }
  const parts = TOOL_BUCKETS.filter((item) => counts.has(item.id)).map((item) => item.label(counts.get(item.id) ?? 0));
  if (other > 0) parts.push(`其他 ${other} 步`);
  if (parts.length === 0) return "";
  const stats = added > 0 || removed > 0 ? ` +${added} -${removed}` : "";
  return `${parts.join("，")}${stats}`;
}

const WORK_FAMILY_LIVE: Record<string, string> = {
  explore: "正在浏览…",
  exec: "正在执行…",
  edit: "正在编辑…",
  other: "正在处理…",
};

export function workGroupLabel(id: string, tools: TranscriptTool[]): string {
  if (tools.some((tool) => tool.status === "running")) {
    return WORK_FAMILY_LIVE[id] ?? "正在处理…";
  }
  if (id === "other") return `其他 ${tools.length} 步`;
  return toolGroupSummary(tools);
}

export function previewWorkTools<T>(tools: readonly T[]): { shown: T[]; hidden: number } {
  if (tools.length <= WORK_GROUP_PREVIEW) return { shown: [...tools], hidden: 0 };
  return { shown: tools.slice(-WORK_GROUP_PREVIEW), hidden: tools.length - WORK_GROUP_PREVIEW };
}

const WORK_FAMILIES = [
  { id: "explore", names: ["read", "grep", "search", "glob", "neo_browse", "browse"] },
  { id: "exec", names: ["bash", "shell"] },
  { id: "edit", names: ["edit", "write", "apply_patch"] },
] as const;

export type WorkBucket = {
  id: string;
  label: string;
  tools: TranscriptTool[];
};

export type PartitionedTurn = {
  notes: string[];
  buckets: WorkBucket[];
  answer: string;
};

function workFamily(tool: TranscriptTool): string {
  if (tool.name === "neo_subagent" || tool.details?.subagent) return "other";
  const name = tool.name.toLowerCase();
  return WORK_FAMILIES.find((item) => (item.names as readonly string[]).includes(name))?.id ?? "other";
}

/** Last text after tools is the reply. Everything before it is the work fold. */
export function partitionTurn(groups: TranscriptGroup[]): PartitionedTurn {
  const hasTools = groups.some((group) => group.type === "tools");
  if (!hasTools) {
    return {
      notes: [],
      buckets: [],
      answer: groups.filter((group) => group.type === "text").map((group) => group.text).join(""),
    };
  }
  let answerAt = -1;
  let seenTools = false;
  groups.forEach((group, index) => {
    if (group.type === "tools") seenTools = true;
    else if (seenTools) answerAt = index;
  });
  const answerGroup = answerAt >= 0 ? groups[answerAt] : undefined;
  const answer = answerGroup?.type === "text" ? answerGroup.text : "";
  const head = answerAt >= 0 ? groups.slice(0, answerAt) : groups;
  const notes: string[] = [];
  const grouped = new Map<string, TranscriptTool[]>();
  for (const group of head) {
    if (group.type === "text") {
      notes.push(group.text);
      continue;
    }
    for (const tool of group.tools) {
      const id = workFamily(tool);
      const list = grouped.get(id) ?? [];
      list.push(tool);
      grouped.set(id, list);
    }
  }
  const buckets = ["explore", "exec", "edit", "other"].flatMap((id) => {
    const tools = grouped.get(id);
    if (!tools || tools.length === 0) return [];
    return [{ id, label: workGroupLabel(id, tools), tools }];
  });
  return { notes, buckets, answer };
}

/** The user's click wins; otherwise a live turn is open and a settled one is closed. */
export function resolveFoldOpen(live: boolean, userChoice: boolean | null): boolean {
  return userChoice ?? live;
}
