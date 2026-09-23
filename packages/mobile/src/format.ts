import {
  CHAT_MODELS as CONTRACT_CHAT_MODELS,
  chatModelLabel as contractChatModelLabel,
  chatModelShortLabel,
  resolvePublicChatModel,
} from "@neo-cloud-agent/contracts/llm-ids";
import type { TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { runDisplayTitle } from "@neo-cloud-agent/contracts/run";

export { RUN_STATUS_LABELS as STATUS_LABELS, toolArgPreview } from "@neo-cloud-agent/contracts/display";

export function preview(text: string): string {
  return (text || "未命名任务").replace(/\s+/g, " ").slice(0, 48);
}

export function runListTitle(run: { title?: string | null; prompt?: string }): string {
  return preview(runDisplayTitle(run));
}

export function shortId(id: string): string {
  return id.slice(0, 8);
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

export const CHAT_MODELS = CONTRACT_CHAT_MODELS.map((item) => ({
  id: item.id,
  label: item.label,
  short: chatModelShortLabel(item.id),
}));

export function resolveChatModel(model?: string | null): string {
  return resolvePublicChatModel("deepseek", model);
}

export function chatModelLabel(model?: string | null): string {
  return contractChatModelLabel(resolveChatModel(model));
}

export function chatModelShort(model?: string | null): string {
  return chatModelShortLabel(resolveChatModel(model));
}

export function avatarLetter(email: string, fallback = "我"): string {
  const letter = (email.trim().split("@")[0] ?? "").charAt(0);
  return letter ? letter.toUpperCase() : fallback;
}
