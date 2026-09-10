export type LlmUpstreamMode = "mock" | "openai" | "deepseek";

/** Official DeepSeek-V4.1-Flash id. Native multimodal. */
export const DEEPSEEK_FLASH_MODEL = "deepseek-flash";
/** Retired 2026-09-10. Official API routes this to V4.1 Flash. */
export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";
/** Retired 2026-09-10. Official API routes this to V4.1 Flash. */
export const DEEPSEEK_VISION_MODEL = DEEPSEEK_FLASH_MODEL;

const DEEPSEEK_FLASH_ALIASES = new Set([
  "",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek",
  "ds",
  "neo/deepseek",
  "neo/ds",
  "neo-deepseek",
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-v4.1-flash",
  "deepseek-v4.1-flash-expires-on-0910",
  "deepseek-v4-1-flash",
  "deepseek-flash-4.1",
  "deepseek-v4-pro",
  "deepseek-pro",
  "deepseek-v4-flash-vision-exp",
  "deepseek-v4-flash-vision",
  "deepseek-flash-vision",
  "deepseek-vision",
]);

export const DEEPSEEK_CHAT_MODELS = [{ id: DEEPSEEK_FLASH_MODEL, label: "DeepSeek Flash 4.1" }] as const;

export function defaultLlmModel(upstream: LlmUpstreamMode): string {
  if (upstream === "deepseek") {
    return DEEPSEEK_FLASH_MODEL;
  }
  if (upstream === "openai") {
    return "gpt-4o-mini";
  }
  return "mock";
}

/** Map retired DeepSeek aliases onto the current official id. */
export function canonicalizeLlmModel(upstream: LlmUpstreamMode, model?: string | null): string {
  const requested = (model ?? "").trim();
  if (upstream === "deepseek") {
    if (DEEPSEEK_FLASH_ALIASES.has(requested) || !requested) {
      return DEEPSEEK_FLASH_MODEL;
    }
    return requested;
  }
  return requested || defaultLlmModel(upstream);
}

export function isDeepseekProModel(_model?: string | null): boolean {
  return false;
}

export function isDeepseekVisionModel(model?: string | null): boolean {
  return canonicalizeLlmModel("deepseek", model) === DEEPSEEK_FLASH_MODEL;
}

export function isDeepseekFlashModel(model?: string | null): boolean {
  return canonicalizeLlmModel("deepseek", model) === DEEPSEEK_FLASH_MODEL;
}

export function deepseekModelLabel(_model?: string | null): string {
  return "DeepSeek Flash 4.1";
}

export function resolveDeepseekChatModel(model?: string | null, _hasImages = false): string {
  return canonicalizeLlmModel("deepseek", model);
}

/** V4.1 Flash is native multimodal; stay on flash instead of a retired vision id. */
export function visionModelFor(model?: string | null): string {
  const id = (model ?? "").trim();
  if (!id) {
    return DEEPSEEK_FLASH_MODEL;
  }
  if (/^gpt-|^o[1-9]|^chatgpt/i.test(id)) {
    return id;
  }
  if (canonicalizeLlmModel("deepseek", id) === DEEPSEEK_FLASH_MODEL) {
    return DEEPSEEK_FLASH_MODEL;
  }
  return id;
}
