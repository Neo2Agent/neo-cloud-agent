import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";

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

export function resolveChatModel(upstream?: string | null, model?: string | null, hasImages = false): string {
  if (upstream === "openai") return "gpt-4o-mini";
  if (/pro/i.test(model ?? "") && !/vision/i.test(model ?? "")) return "deepseek-v4-pro";
  if (hasImages || /vision/i.test(model ?? "")) return "deepseek-v4-flash-vision-exp";
  return "deepseek-v4-flash";
}

export function modelLabel(upstream?: string | null, model?: string | null): string {
  if (upstream === "openai") return "OpenAI";
  if (upstream === "deepseek" || /deepseek/i.test(model ?? "")) {
    if (/vision/i.test(model ?? "")) return "DeepSeek Flash Vision";
    return /pro/i.test(model ?? "") ? "DeepSeek Pro" : "DeepSeek Flash";
  }
  return upstream || "LLM";
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

export function slotLabel(id?: string | null): string {
  const raw = String(id || "");
  const match = /^slot-(\d+)$/.exec(raw);
  if (match) return `VM ${Number(match[1]) + 1}`;
  return raw || "未分配";
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
