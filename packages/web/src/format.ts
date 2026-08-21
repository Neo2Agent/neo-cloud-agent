import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";

export const STATUS_LABELS: Record<string, string> = {
  idle: "就绪",
  NOT_YET_STARTED: "未开始",
  PROVISIONING: "准备中",
  INSTALLING: "安装中",
  RUNNING: "运行中",
  IDLE: "空闲",
  WAITING_FOR_BACKGROUND_WORK: "后台任务",
  ERROR: "出错",
  ARCHIVED: "已归档",
  EXPIRED: "已过期",
};

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

export function toolArgPreview(args: unknown): string {
  if (!args || typeof args !== "object") {
    return args == null ? "" : String(args);
  }
  const record = args as Record<string, unknown>;
  for (const key of ["command", "cmd", "path", "file", "query", "pattern", "url", "message", "title"]) {
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
