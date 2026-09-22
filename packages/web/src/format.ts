import { CHAT_MODELS, chatModelLabel, resolvePublicChatModel } from "@neo-cloud-agent/contracts/llm-ids";
import { isDeskHostedTarget } from "@neo-cloud-agent/contracts/desk";
import type { TranscriptGroup, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { isRemoteControlTarget, runDisplayTitle, type ExecutionTarget } from "@neo-cloud-agent/contracts/run";

export const STATUS_LABELS: Record<string, string> = {
  idle: "就绪",
  NOT_YET_STARTED: "排队中",
  PROVISIONING: "准备中",
  INSTALLING: "安装中",
  RUNNING: "运行中",
  IDLE: "空闲",
  WAITING_FOR_BACKGROUND_WORK: "后台任务",
  ERROR: "出错",
  ARCHIVED: "已归档",
  EXPIRED: "已过期",
};

export function resolveChatModel(upstream?: string | null, model?: string | null, _hasImages = false): string {
  return resolvePublicChatModel(upstream, model);
}

export function modelLabel(_upstream?: string | null, model?: string | null): string {
  return chatModelLabel(model);
}

export function nextChatModel(
  current?: string | null,
  models: Array<{ id: string }> = CHAT_MODELS,
): string {
  const list = models.length > 0 ? models : CHAT_MODELS;
  const index = list.findIndex((item) => item.id === current);
  return list[(index + 1 + list.length) % list.length]!.id;
}

export function upstreamForChatModel(model: string, fallback = "deepseek"): string {
  if (/^gpt-|^o[1-9]|^chatgpt/i.test(model)) return "openai";
  return fallback === "openai" ? "deepseek" : fallback || "deepseek";
}

export function formatUsage(usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null): string {
  if (!usage) return "";
  const total = usage.totalTokens || (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  if (!total) return "";
  return `${total} tok`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function preview(text: string): string {
  return (text || "未命名任务").replace(/\s+/g, " ").slice(0, 42);
}

export function runListTitle(run: { title?: string | null; prompt?: string }): string {
  return preview(runDisplayTitle(run));
}

export function slotLabel(id?: string | null): string {
  const raw = String(id || "");
  const match = /^slot-(\d+)$/.exec(raw);
  if (match) return `VM ${Number(match[1]) + 1}`;
  return raw || "未分配";
}

export function runListPlaceSuffix(run: {
  executionTarget?: ExecutionTarget | null;
  vmSlotId?: string | null;
}): string {
  if (isRemoteControlTarget(run.executionTarget)) return " · Remote";
  if (isDeskHostedTarget(run.executionTarget)) return " · 本机";
  return run.vmSlotId ? ` · ${slotLabel(run.vmSlotId)}` : "";
}

const SHANGHAI = "Asia/Shanghai";

export function sameClockMinute(left: string, right: string): boolean {
  const start = Date.parse(left);
  const end = Date.parse(right);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return left === right;
  return Math.floor(start / 60_000) === Math.floor(end / 60_000);
}

function shanghaiYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI, year: "numeric" }).format(date);
}

/** Compact list age, Cursor-style: minutes, then hours, then days. */
export function formatListWhen(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  return `${Math.floor(hours / 24)}天`;
}

/** Asia/Shanghai wall clock, e.g. `8/24 17:30`. Drops the year when it matches `now`. */
export function formatWhen(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const sameYear = shanghaiYear(date) === shanghaiYear(now);
  return date.toLocaleString("zh-CN", {
    timeZone: SHANGHAI,
    year: sameYear ? undefined : "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatRunTime(createdAt: string, updatedAt?: string | null, now = new Date()): string {
  const created = formatWhen(createdAt, now);
  if (!updatedAt || sameClockMinute(createdAt, updatedAt)) {
    return created;
  }
  return `创建 ${created} · 更新 ${formatWhen(updatedAt, now)}`;
}

export function formatDuration(start: string, end?: string | null, now = new Date()): string {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "";
  const sec = Math.max(1, Math.round((to - from) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m${rem}s` : `${min}m`;
}

export function formatMessageTime(
  createdAt: string,
  updatedAt?: string | null,
  streaming = false,
  now = new Date(),
): string {
  const created = formatWhen(createdAt, now);
  if (streaming || !updatedAt || sameClockMinute(createdAt, updatedAt)) {
    return created;
  }
  return `${created} · 完成 ${formatWhen(updatedAt, now)}`;
}

export function toolArgPreview(args: unknown): string {
  if (!args || typeof args !== "object") {
    return args == null ? "" : String(args);
  }
  const record = args as Record<string, unknown>;
  const agent = typeof record.agent === "string" ? record.agent.trim() : "";
  const task = typeof record.task === "string" ? record.task.trim() : "";
  if (agent && task) {
    return `${agent}: ${task.replace(/\s+/g, " ").trim()}`;
  }
  if (Array.isArray(record.tasks) && record.tasks.length > 0) {
    return `parallel ×${record.tasks.length}`;
  }
  if (Array.isArray(record.chain) && record.chain.length > 0) {
    return `chain ×${record.chain.length}`;
  }
  for (const key of ["command", "cmd", "path", "file", "query", "pattern", "url", "message", "title", "task", "agent"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, " ").trim();
    }
  }
  try {
    return JSON.stringify(args);
  } catch {
    return "";
  }
}

export function toolTitle(tool: TranscriptTool): string {
  const mark = tool.status === "running" ? "…" : tool.isError ? "✗" : "✓";
  const previewText = toolArgPreview(tool.args);
  return previewText ? `${mark} ${tool.name} · ${previewText}` : `${mark} ${tool.name}`;
}

export type DiffLine = { type: "add" | "del" | "ctx"; text: string };

const DIFF_LIMIT = 80;

function recordArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

export function parseUnifiedDiff(diff: string): DiffLine[] {
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
    if (lines.length >= DIFF_LIMIT) {
      break;
    }
  }
  return lines;
}

export function fileToolDiff(tool: TranscriptTool): { path: string; lines: DiffLine[] } | null {
  const args = recordArgs(tool.args);
  const path = typeof args.path === "string" ? args.path : "";
  const detailsDiff = typeof tool.details?.diff === "string" ? tool.details.diff : typeof tool.details?.patch === "string" ? tool.details.patch : "";
  if (detailsDiff) {
    const lines = parseUnifiedDiff(detailsDiff);
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

export function toolDiffStat(tool: TranscriptTool): { added: number; removed: number } | null {
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

const EXPLORE_TOOLS = ["read", "grep", "search", "glob", "neo_browse", "browse"] as const;
const EXEC_TOOLS = ["bash", "shell"] as const;
const EDIT_TOOLS = ["edit", "write", "apply_patch"] as const;

const WORK_FAMILIES = [
  { id: "explore", names: EXPLORE_TOOLS },
  { id: "exec", names: EXEC_TOOLS },
  { id: "edit", names: EDIT_TOOLS },
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
    const label = id === "other" ? `其他 ${tools.length} 步` : toolGroupSummary(tools);
    return [{ id, label, tools }];
  });
  return { notes, buckets, answer };
}

/** A live turn stays open. A finished turn stays closed until the user opens it. */
export function resolveWorkFoldOpen(streaming: boolean, userChoice: boolean | null): boolean {
  if (userChoice != null) return userChoice;
  return streaming;
}

export type SlotMenuLine = {
  id: string;
  label: string;
  runId: string | null;
};

/** Idle slots stay visible and are not buttons. Busy slots name the conversation. */
export function slotMenuLines(
  slots: Array<{ id: string; status: string; runId: string | null }>,
  runs: Array<{ id: string; prompt: string; vmSlotId?: string | null }>,
): SlotMenuLine[] {
  return slots.map((slot) => {
    const run = runs.find((item) => item.id === slot.runId || item.vmSlotId === slot.id);
    const name = slotLabel(slot.id);
    const busy = slot.status === "busy" || Boolean(slot.runId);
    if (!busy) return { id: slot.id, label: `${name} · 空闲`, runId: null };
    const title = run ? preview(run.prompt) : slot.runId?.slice(0, 8) || "占用";
    return { id: slot.id, label: `${name} · ${title}`, runId: run?.id || slot.runId };
  });
}
