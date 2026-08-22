import { CLOUD_SYSTEM_PROMPT, BASELINE_TOOL_TEXT } from "./system-prompt.js";
import { resolveModelLimits } from "./models.js";

export { resolveModelLimits };

export type ContextUsageBucketId = "system" | "tools" | "summarized" | "conversation";

export interface ContextUsageBucket {
  id: ContextUsageBucketId;
  label: string;
  tokens: number;
}

export interface ContextUsageSnapshot {
  tokens: number;
  /** Advertised model window. Null when this model is not in the catalog. */
  contextWindow: number | null;
  percent: number | null;
  source: "session" | "estimate";
  model?: string;
  buckets: ContextUsageBucket[];
}

export const CONTEXT_BUCKET_LABELS: Record<ContextUsageBucketId, string> = {
  system: "系统提示",
  tools: "工具定义",
  summarized: "已压缩对话",
  conversation: "对话",
};

const BUCKET_IDS = new Set<ContextUsageBucketId>(["system", "tools", "summarized", "conversation"]);

/** Same chars/4 heuristic pi uses for estimates. */
export function estimateTokensFromText(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

export function formatTokenCount(tokens: number): string {
  const abs = Math.max(0, tokens);
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (abs >= 1000) {
    const thousands = abs / 1000;
    return thousands >= 100 || Number.isInteger(thousands) ? `${Math.round(thousands)}K` : `${thousands.toFixed(1)}K`;
  }
  return String(Math.round(abs));
}

export function assembleContextUsage(input: {
  model?: string;
  contextWindow?: number | null;
  reportedTokens?: number | null;
  systemText?: string;
  toolsText?: string;
  summarizedText?: string;
  conversationText?: string;
  source?: "session" | "estimate";
}): ContextUsageSnapshot {
  const catalogWindow = resolveModelLimits(input.model)?.contextWindow ?? null;
  const rawWindow = input.contextWindow;
  const contextWindow =
    typeof rawWindow === "number" && Number.isFinite(rawWindow) && rawWindow > 0
      ? Math.round(rawWindow)
      : catalogWindow;
  const system = estimateTokensFromText(input.systemText ?? "");
  const tools = estimateTokensFromText(input.toolsText ?? "");
  const summarizedEst = estimateTokensFromText(input.summarizedText ?? "");
  const conversationEst = estimateTokensFromText(input.conversationText ?? "");
  const estimatedTotal = system + tools + summarizedEst + conversationEst;
  const reported = input.reportedTokens;
  const hasReported = typeof reported === "number" && Number.isFinite(reported) && reported > 0;
  const tokens = hasReported ? Math.round(reported) : estimatedTotal;
  const fixed = system + tools;
  const variableEst = summarizedEst + conversationEst;
  let summarized = summarizedEst;
  let conversation = conversationEst;
  if (hasReported) {
    const remaining = Math.max(0, tokens - fixed);
    if (variableEst > 0) {
      summarized = Math.round(remaining * (summarizedEst / variableEst));
      conversation = Math.max(0, remaining - summarized);
    } else {
      summarized = 0;
      conversation = remaining;
    }
  }
  const buckets: ContextUsageBucket[] = (
    [
      { id: "system", label: CONTEXT_BUCKET_LABELS.system, tokens: system },
      { id: "tools", label: CONTEXT_BUCKET_LABELS.tools, tokens: tools },
      { id: "summarized", label: CONTEXT_BUCKET_LABELS.summarized, tokens: summarized },
      { id: "conversation", label: CONTEXT_BUCKET_LABELS.conversation, tokens: conversation },
    ] satisfies ContextUsageBucket[]
  ).filter((bucket) => bucket.tokens > 0);
  return {
    tokens,
    contextWindow,
    percent: contextWindow ? (tokens / contextWindow) * 100 : null,
    source: hasReported || input.source === "session" ? "session" : "estimate",
    model: input.model,
    buckets,
  };
}

export function overlayContextUsage(
  base: ContextUsageSnapshot,
  extra: { draft?: string; streaming?: string },
): ContextUsageSnapshot {
  const add = estimateTokensFromText(extra.draft ?? "") + estimateTokensFromText(extra.streaming ?? "");
  if (!add) {
    return base;
  }
  const buckets = base.buckets.map((bucket) => ({ ...bucket }));
  const conversation = buckets.find((bucket) => bucket.id === "conversation");
  if (conversation) {
    conversation.tokens += add;
  } else {
    buckets.push({ id: "conversation", label: CONTEXT_BUCKET_LABELS.conversation, tokens: add });
  }
  const tokens = base.tokens + add;
  return {
    ...base,
    tokens,
    percent: base.contextWindow ? (tokens / base.contextWindow) * 100 : null,
    buckets,
  };
}

export function baselineContextUsage(model?: string | null): ContextUsageSnapshot {
  return assembleContextUsage({
    model: model ?? undefined,
    systemText: CLOUD_SYSTEM_PROMPT,
    toolsText: BASELINE_TOOL_TEXT,
  });
}

export function parseContextUsage(data?: Record<string, unknown> | null): ContextUsageSnapshot | null {
  if (!data) {
    return null;
  }
  const tokens = Number(data.tokens);
  if (!Number.isFinite(tokens) || tokens < 0) {
    return null;
  }
  const rawWindow = data.contextWindow;
  const contextWindow =
    rawWindow == null || rawWindow === ""
      ? null
      : Number.isFinite(Number(rawWindow)) && Number(rawWindow) > 0
        ? Math.round(Number(rawWindow))
        : null;
  const buckets: ContextUsageBucket[] = [];
  if (Array.isArray(data.buckets)) {
    for (const item of data.buckets) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const id = rec.id;
      const bucketTokens = Number(rec.tokens);
      if (typeof id !== "string" || !BUCKET_IDS.has(id as ContextUsageBucketId) || !Number.isFinite(bucketTokens)) {
        continue;
      }
      buckets.push({
        id: id as ContextUsageBucketId,
        label: typeof rec.label === "string" ? rec.label : CONTEXT_BUCKET_LABELS[id as ContextUsageBucketId],
        tokens: Math.max(0, Math.round(bucketTokens)),
      });
    }
  }
  return {
    tokens: Math.round(tokens),
    contextWindow,
    percent: contextWindow ? (tokens / contextWindow) * 100 : null,
    source: data.source === "session" ? "session" : "estimate",
    model: typeof data.model === "string" ? data.model : undefined,
    buckets,
  };
}

export function contextUsageToData(snapshot: ContextUsageSnapshot): Record<string, unknown> {
  return {
    tokens: snapshot.tokens,
    contextWindow: snapshot.contextWindow,
    percent: snapshot.percent,
    source: snapshot.source,
    model: snapshot.model,
    buckets: snapshot.buckets,
  };
}
