import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";

export const STATUS_LABELS: Record<string, string> = {
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

export function preview(text: string): string {
  return (text || "未命名任务").replace(/\s+/g, " ").slice(0, 48);
}

export function runListTitle(run: { title?: string | null; prompt?: string }): string {
  return preview(run.title?.trim() || run.prompt || "");
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function toolArgPreview(args: unknown): string {
  if (!args || typeof args !== "object") {
    return typeof args === "string" ? args.slice(0, 80) : "";
  }
  const record = args as Record<string, unknown>;
  const command = record.command ?? record.cmd ?? record.path ?? record.url;
  return typeof command === "string" ? command.replace(/\s+/g, " ").slice(0, 80) : "";
}

export function toolBodyText(tool: Pick<TranscriptTool, "output" | "status">): string {
  if (tool.output?.trim()) return tool.output.trim();
  return tool.status === "running" ? "执行中…" : "";
}

export function toolDisplayName(tool: TranscriptTool): string {
  const nested = typeof tool.details?.subagent === "string" ? tool.details.subagent : "";
  if (nested && tool.name !== "neo_subagent") {
    return `${nested} / ${tool.name}`;
  }
  return tool.name === "neo_subagent" ? "subagent" : tool.name;
}

export const CHAT_MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek Flash", short: "Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek Pro", short: "Pro" },
] as const;

export function resolveChatModel(model?: string | null): string {
  if (/pro/i.test(model ?? "") && !/vision/i.test(model ?? "")) return "deepseek-v4-pro";
  return "deepseek-v4-flash";
}

export function chatModelLabel(model?: string | null): string {
  return resolveChatModel(model) === "deepseek-v4-pro" ? "DeepSeek Pro" : "DeepSeek Flash";
}

export function chatModelShort(model?: string | null): string {
  return resolveChatModel(model) === "deepseek-v4-pro" ? "Pro" : "Flash";
}

export function avatarLetter(email: string, fallback = "我"): string {
  const letter = (email.trim().split("@")[0] ?? "").charAt(0);
  return letter ? letter.toUpperCase() : fallback;
}
