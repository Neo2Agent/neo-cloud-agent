export type LlmUpstreamMode = "mock" | "openai" | "deepseek";

export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";
export const DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";

const DEEPSEEK_FLASH_ALIASES = new Set([
  "",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek",
  "ds",
  "neo/deepseek",
  "neo/ds",
  "neo-deepseek",
  "deepseek-v4-flash",
  "deepseek-flash",
]);

const DEEPSEEK_PRO_ALIASES = new Set(["deepseek-v4-pro", "deepseek-pro"]);

const DEEPSEEK_VISION_ALIASES = new Set([
  "deepseek-v4-flash-vision-exp",
  "deepseek-v4-flash-vision",
  "deepseek-flash-vision",
  "deepseek-vision",
]);

export function defaultLlmModel(upstream: LlmUpstreamMode): string {
  if (upstream === "deepseek") {
    return DEEPSEEK_FLASH_MODEL;
  }
  if (upstream === "openai") {
    return "gpt-4o-mini";
  }
  return "mock";
}

/** Map retired DeepSeek aliases onto the current official ids. */
export function canonicalizeLlmModel(upstream: LlmUpstreamMode, model?: string | null): string {
  const requested = (model ?? "").trim();
  if (upstream === "deepseek") {
    if (DEEPSEEK_VISION_ALIASES.has(requested)) {
      return DEEPSEEK_VISION_MODEL;
    }
    if (DEEPSEEK_PRO_ALIASES.has(requested)) {
      return DEEPSEEK_PRO_MODEL;
    }
    if (DEEPSEEK_FLASH_ALIASES.has(requested) || !requested) {
      return DEEPSEEK_FLASH_MODEL;
    }
    return requested;
  }
  return requested || defaultLlmModel(upstream);
}

export function isDeepseekProModel(model?: string | null): boolean {
  return canonicalizeLlmModel("deepseek", model) === DEEPSEEK_PRO_MODEL;
}

export function isDeepseekVisionModel(model?: string | null): boolean {
  return canonicalizeLlmModel("deepseek", model) === DEEPSEEK_VISION_MODEL;
}

/** Text-only DeepSeek Flash should upgrade when the request carries images. */
export function visionModelFor(model?: string | null): string {
  const id = (model ?? "").trim();
  if (!id) {
    return DEEPSEEK_VISION_MODEL;
  }
  if (isDeepseekProModel(id) || /^gpt-|^o[1-9]|^chatgpt/i.test(id)) {
    return id;
  }
  if (canonicalizeLlmModel("deepseek", id) === DEEPSEEK_FLASH_MODEL) {
    return DEEPSEEK_VISION_MODEL;
  }
  return id;
}
