import {
  DEEPSEEK_CHAT_MODELS,
  DEEPSEEK_FLASH_41_MODEL,
  DEEPSEEK_FLASH_MODEL,
  DEEPSEEK_PRO_MODEL,
  DEEPSEEK_VISION_MODEL,
  deepseekModelLabel,
  resolveDeepseekChatModel,
} from "@neo-cloud-agent/contracts";
import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { runDisplayTitle } from "@neo-cloud-agent/contracts/run";

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
  return preview(runDisplayTitle(run));
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

export const CHAT_MODELS = DEEPSEEK_CHAT_MODELS.map((item) => ({
  id: item.id,
  label: item.label,
  short: item.id === DEEPSEEK_PRO_MODEL ? "Pro" : item.id === DEEPSEEK_FLASH_41_MODEL ? "4.1" : "Flash",
}));

export function resolveChatModel(model?: string | null): string {
  const id = resolveDeepseekChatModel(model, false);
  return id === DEEPSEEK_VISION_MODEL ? DEEPSEEK_FLASH_MODEL : id;
}

export function chatModelLabel(model?: string | null): string {
  return deepseekModelLabel(resolveChatModel(model));
}

export function chatModelShort(model?: string | null): string {
  const id = resolveChatModel(model);
  if (id === DEEPSEEK_FLASH_41_MODEL) return "4.1";
  return id === DEEPSEEK_PRO_MODEL ? "Pro" : "Flash";
}

export function avatarLetter(email: string, fallback = "我"): string {
  const letter = (email.trim().split("@")[0] ?? "").charAt(0);
  return letter ? letter.toUpperCase() : fallback;
}
