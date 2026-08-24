import { canonicalizeLlmModel, type LlmUpstreamMode } from "./llm-ids.js";

/** Official context / output limits. Only listed models have a known window. */
export interface ModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

const DEEPSEEK_V4: ModelLimits = {
  contextWindow: 1_000_000,
  maxOutputTokens: 384_000,
};

const GPT_4O: ModelLimits = {
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
};

const LIMITS_BY_ID: Record<string, ModelLimits> = {
  "deepseek-v4-flash": DEEPSEEK_V4,
  "deepseek-v4-pro": DEEPSEEK_V4,
  "deepseek-v4-flash-vision-exp": DEEPSEEK_V4,
  "gpt-4o-mini": GPT_4O,
  "gpt-4o": GPT_4O,
};

function stripProvider(modelId: string): string {
  const trimmed = modelId.trim();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function guessUpstream(modelId: string): LlmUpstreamMode {
  const id = modelId.trim();
  if (/^gpt-|^o[1-9]|^chatgpt/i.test(id) || /^neo\/gpt/i.test(id)) {
    return "openai";
  }
  if (/deepseek|^ds$|^neo\/ds/i.test(id)) {
    return "deepseek";
  }
  return "mock";
}

/** Resolve a public or upstream model id to its advertised limits. Unknown models return null. */
export function resolveModelLimits(modelId?: string | null): ModelLimits | null {
  const raw = (modelId ?? "").trim();
  if (!raw) {
    return null;
  }
  const upstream = guessUpstream(raw);
  const canonical = canonicalizeLlmModel(upstream, raw);
  const keys = [canonical, raw, stripProvider(canonical), stripProvider(raw)].map((item) => item.toLowerCase());
  for (const key of keys) {
    const limits = LIMITS_BY_ID[key];
    if (limits) {
      return limits;
    }
  }
  return null;
}
