export type LlmUpstreamMode = "mock" | "openai" | "deepseek";

export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";
export const DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";
/** Preview id; DeepSeek's public docs still list V4 Flash. Expires 2026-09-10. */
export const DEEPSEEK_FLASH_41_MODEL = "deepseek-v4.1-flash-expires-on-0910";

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

const DEEPSEEK_FLASH_41_ALIASES = new Set([
  DEEPSEEK_FLASH_41_MODEL,
  "deepseek-v4.1-flash",
  "deepseek-v4-1-flash",
  "deepseek-flash-4.1",
  "deepseek-v4.1",
]);

export const DEEPSEEK_CHAT_MODELS = [
  { id: DEEPSEEK_FLASH_MODEL, label: "DeepSeek Flash" },
  { id: DEEPSEEK_FLASH_41_MODEL, label: "DeepSeek Flash 4.1" },
  { id: DEEPSEEK_PRO_MODEL, label: "DeepSeek Pro" },
] as const;

export const DEEPSEEK_SETTINGS_MODELS = [
  { id: DEEPSEEK_FLASH_MODEL, label: "Flash（便宜）" },
  { id: DEEPSEEK_FLASH_41_MODEL, label: "Flash 4.1（预览）" },
  { id: DEEPSEEK_VISION_MODEL, label: "Flash Vision（看图）" },
  { id: DEEPSEEK_PRO_MODEL, label: "Pro" },
] as const;

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
    if (DEEPSEEK_FLASH_41_ALIASES.has(requested)) {
      return DEEPSEEK_FLASH_41_MODEL;
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

export function isDeepseekFlash41Model(model?: string | null): boolean {
  return canonicalizeLlmModel("deepseek", model) === DEEPSEEK_FLASH_41_MODEL;
}

export function deepseekModelLabel(model?: string | null): string {
  const id = canonicalizeLlmModel("deepseek", model);
  if (id === DEEPSEEK_FLASH_41_MODEL) return "DeepSeek Flash 4.1";
  if (id === DEEPSEEK_VISION_MODEL) return "DeepSeek Flash Vision";
  if (id === DEEPSEEK_PRO_MODEL) return "DeepSeek Pro";
  return "DeepSeek Flash";
}

export function selectDeepseekModelOption(model?: string | null): string {
  const id = canonicalizeLlmModel("deepseek", model);
  if (id === DEEPSEEK_FLASH_41_MODEL || id === DEEPSEEK_VISION_MODEL || id === DEEPSEEK_PRO_MODEL) {
    return id;
  }
  return DEEPSEEK_FLASH_MODEL;
}

export function resolveDeepseekChatModel(model?: string | null, hasImages = false): string {
  const canonical = canonicalizeLlmModel("deepseek", model);
  if (canonical === DEEPSEEK_FLASH_41_MODEL) {
    return DEEPSEEK_FLASH_41_MODEL;
  }
  if (canonical === DEEPSEEK_PRO_MODEL) {
    return DEEPSEEK_PRO_MODEL;
  }
  if (hasImages || canonical === DEEPSEEK_VISION_MODEL) {
    return DEEPSEEK_VISION_MODEL;
  }
  return DEEPSEEK_FLASH_MODEL;
}

/** Text-only DeepSeek Flash should upgrade when the request carries images. */
export function visionModelFor(model?: string | null): string {
  const id = (model ?? "").trim();
  if (!id) {
    return DEEPSEEK_VISION_MODEL;
  }
  if (isDeepseekFlash41Model(id)) {
    return DEEPSEEK_FLASH_41_MODEL;
  }
  if (isDeepseekProModel(id) || /^gpt-|^o[1-9]|^chatgpt/i.test(id)) {
    return id;
  }
  if (canonicalizeLlmModel("deepseek", id) === DEEPSEEK_FLASH_MODEL) {
    return DEEPSEEK_VISION_MODEL;
  }
  return id;
}
