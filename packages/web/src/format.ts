import { CHAT_MODELS, chatModelLabel, resolvePublicChatModel } from "@neo-cloud-agent/contracts/llm-ids";
import { isDeskHostedTarget } from "@neo-cloud-agent/contracts/desk";
import {
  formatDuration,
  formatWhen,
  RUN_STATUS_LABELS,
  sameClockMinute,
  toolArgPreview,
} from "@neo-cloud-agent/contracts/display";
import { isRemoteControlTarget, runDisplayTitle, type ExecutionTarget } from "@neo-cloud-agent/contracts/run";

export { formatDuration, formatWhen, toolArgPreview };

export const STATUS_LABELS: Record<string, string> = { idle: "就绪", ...RUN_STATUS_LABELS };

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

/** Sidebar rest-state age, same units Cursor paints on the right. */
export function formatSidebarAge(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatRunTime(createdAt: string, updatedAt?: string | null, now = new Date()): string {
  const created = formatWhen(createdAt, now);
  if (!updatedAt || sameClockMinute(createdAt, updatedAt)) {
    return created;
  }
  return `创建 ${created} · 更新 ${formatWhen(updatedAt, now)}`;
}

export { formatMessageTime } from "@neo-cloud-agent/contracts/turn-view";
export {
  fileCardPreview,
  fileToolDiff,
  parseUnifiedDiff,
  partitionTurn,
  previewWorkTools,
  resolveFoldOpen,
  toolChromeKind,
  toolDiffStat,
  toolGroupSummary,
  toolLinkLabel,
  toolVerb,
  workGroupLabel,
  WORK_GROUP_PREVIEW,
  WRITE_PREVIEW_LINES,
  type DiffLine,
  type PartitionedTurn,
  type ToolChromeKind,
  type WorkBucket,
} from "@neo-cloud-agent/contracts/work-view";

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
