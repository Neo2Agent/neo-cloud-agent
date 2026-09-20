import {
  canonicalizeLlmModel,
  DEEPSEEK_FLASH_MODEL,
  isDeepseekAlias,
  isStepfunModel,
  STEP_5_PREVIEW_MODEL,
  visionModelFor,
} from "@neo-cloud-agent/contracts";

/** Map the public model id (what the Run stores) to an upstream model id. */
export function resolveUpstreamModel(requested: string, fallback: string): string {
  const id = requested.trim();
  if (isStepfunModel(id)) {
    return STEP_5_PREVIEW_MODEL;
  }
  if (isDeepseekAlias(id)) {
    return DEEPSEEK_FLASH_MODEL;
  }
  const legacy: Record<string, string> = {
    "neo/sonnet": fallback,
    "neo-sonnet": fallback,
    sonnet: fallback,
    "neo/gpt": process.env.LLM_UPSTREAM_GPT_MODEL ?? "gpt-4o",
  };
  if (Object.hasOwn(legacy, id)) {
    const mapped = legacy[id]!;
    const upstream = /^gpt-|^o[1-9]|^chatgpt/i.test(mapped) ? "openai" : "deepseek";
    return canonicalizeLlmModel(upstream, mapped);
  }
  if (!id) {
    return canonicalizeLlmModel("deepseek", fallback);
  }
  return canonicalizeLlmModel("deepseek", id);
}

export function messagesHaveImages(messages?: unknown[]): boolean {
  if (!Array.isArray(messages)) {
    return false;
  }
  return messages.some((message) => {
    if (!message || typeof message !== "object") {
      return false;
    }
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return false;
    }
    return content.some((part) => {
      if (!part || typeof part !== "object") {
        return false;
      }
      const type = (part as { type?: unknown }).type;
      return type === "image_url" || type === "image";
    });
  });
}

export { visionModelFor };
