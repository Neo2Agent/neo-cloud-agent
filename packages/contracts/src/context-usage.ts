import { CLOUD_SYSTEM_PROMPT, BASELINE_BUILTIN_TOOL_TEXT, BASELINE_CLOUD_TOOL_TEXT } from "./system-prompt.js";
import { resolveModelLimits } from "./models.js";

export { resolveModelLimits };

export type ContextUsageBucketId =
  | "system"
  | "rules"
  | "memory"
  | "skills"
  | "tools"
  | "cloudTools"
  | "mcp"
  | "subagents"
  | "summarized"
  | "conversation";

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
  rules: "规则",
  memory: "记忆",
  skills: "技能目录",
  tools: "内置工具",
  cloudTools: "云端工具",
  mcp: "MCP 与动态工具",
  subagents: "Subagent 定义",
  summarized: "已压缩对话",
  conversation: "对话",
};

/** Render order for the bar and legend. Keeps segments stable across snapshots. */
export const CONTEXT_BUCKET_ORDER: ContextUsageBucketId[] = [
  "system",
  "rules",
  "memory",
  "skills",
  "tools",
  "cloudTools",
  "mcp",
  "subagents",
  "summarized",
  "conversation",
];

const BUCKET_IDS = new Set<ContextUsageBucketId>(CONTEXT_BUCKET_ORDER);

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

/**
 * Scales every bucket by the same factor so the parts add up to the tokens the
 * provider actually reported. The previous behaviour left the system and tool
 * buckets at their raw estimate and made `conversation` absorb the whole error,
 * which showed an empty conversation whenever the estimate overshot.
 */
function scaleToReported(
  estimates: Record<ContextUsageBucketId, number>,
  estimatedTotal: number,
  tokens: number,
): Record<ContextUsageBucketId, number> {
  if (estimatedTotal <= 0) {
    return { ...estimates, conversation: tokens };
  }
  const factor = tokens / estimatedTotal;
  const scaled = { ...estimates };
  let largest: ContextUsageBucketId = "conversation";
  let sum = 0;
  for (const id of CONTEXT_BUCKET_ORDER) {
    scaled[id] = Math.round(estimates[id] * factor);
    sum += scaled[id];
    if (scaled[id] > scaled[largest]) {
      largest = id;
    }
  }
  // Rounding each bucket independently drifts by a few tokens; park it on the
  // biggest bucket so the parts still sum to `tokens` exactly.
  scaled[largest] = Math.max(0, scaled[largest] + (tokens - sum));
  return scaled;
}

export function assembleContextUsage(input: {
  model?: string;
  contextWindow?: number | null;
  reportedTokens?: number | null;
  /** The whole system prompt. Attributable sections below are subtracted from it. */
  systemText?: string;
  rulesText?: string;
  memoryText?: string;
  skillsText?: string;
  subagentsText?: string;
  toolsText?: string;
  cloudToolsText?: string;
  mcpText?: string;
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

  const rules = estimateTokensFromText(input.rulesText ?? "");
  const memory = estimateTokensFromText(input.memoryText ?? "");
  const skills = estimateTokensFromText(input.skillsText ?? "");
  const subagents = estimateTokensFromText(input.subagentsText ?? "");
  // These sections live inside the system prompt string, so the leftover is
  // what stays in the `system` bucket. Keeps the parts summing to the whole no
  // matter how pi rearranges its template.
  const systemWhole = estimateTokensFromText(input.systemText ?? "");
  const system = Math.max(0, systemWhole - rules - memory - skills - subagents);

  const estimates: Record<ContextUsageBucketId, number> = {
    system,
    rules,
    memory,
    skills,
    subagents,
    tools: estimateTokensFromText(input.toolsText ?? ""),
    cloudTools: estimateTokensFromText(input.cloudToolsText ?? ""),
    mcp: estimateTokensFromText(input.mcpText ?? ""),
    summarized: estimateTokensFromText(input.summarizedText ?? ""),
    conversation: estimateTokensFromText(input.conversationText ?? ""),
  };
  const estimatedTotal = CONTEXT_BUCKET_ORDER.reduce((sum, id) => sum + estimates[id], 0);

  const reported = input.reportedTokens;
  const hasReported = typeof reported === "number" && Number.isFinite(reported) && reported > 0;
  const tokens = hasReported ? Math.round(reported) : estimatedTotal;
  const resolved = hasReported ? scaleToReported(estimates, estimatedTotal, tokens) : estimates;

  const buckets: ContextUsageBucket[] = CONTEXT_BUCKET_ORDER.map((id) => ({
    id,
    label: CONTEXT_BUCKET_LABELS[id],
    tokens: resolved[id],
  })).filter((bucket) => bucket.tokens > 0);

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
    toolsText: BASELINE_BUILTIN_TOOL_TEXT,
    cloudToolsText: BASELINE_CLOUD_TOOL_TEXT,
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
    buckets.sort((a, b) => CONTEXT_BUCKET_ORDER.indexOf(a.id) - CONTEXT_BUCKET_ORDER.indexOf(b.id));
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
