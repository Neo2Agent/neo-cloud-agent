export type LlmUpstreamMode = "mock" | "openai" | "deepseek";

export type ChatModelOption = { id: string; label: string };

export type LlmModelsSource = "newapi" | "static";

/** Official DeepSeek-V4.1-Flash id. Native multimodal. */
export const DEEPSEEK_FLASH_MODEL = "deepseek-flash";
/** Retired 2026-09-10. Official API routes this to V4.1 Flash. */
export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";
/** Retired 2026-09-10. Official API routes this to V4.1 Flash. */
export const DEEPSEEK_VISION_MODEL = DEEPSEEK_FLASH_MODEL;

/** Official StepFun Step 5 Preview id. Native multimodal, 1M context. */
export const STEP_5_PREVIEW_MODEL = "step-5-preview";
export const STEP_5_PREVIEW_LABEL = "Step 5 Preview";

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

const STEPFUN_ALIASES = new Set([
  "step-5-preview",
  "step5",
  "step-5",
  "step",
  "neo/step",
  "neo/stepfun",
  "neo-step",
  "stepfun",
]);

const NON_CHAT_MODEL = /^(tts|whisper|dall-e|dalle|stepaudio|step-tts|step-asr|step-2x|step-image)/i;

export const DEEPSEEK_CHAT_MODELS = [{ id: DEEPSEEK_FLASH_MODEL, label: "DeepSeek Flash 4.1" }] as const;

/** Static picker used when New API /v1/models is unavailable. */
export const CHAT_MODELS: ChatModelOption[] = [
  { id: DEEPSEEK_FLASH_MODEL, label: "DeepSeek Flash 4.1" },
  { id: STEP_5_PREVIEW_MODEL, label: STEP_5_PREVIEW_LABEL },
];

export function isDeepseekAlias(model?: string | null): boolean {
  const id = (model ?? "").trim();
  return id.length > 0 && DEEPSEEK_FLASH_ALIASES.has(id);
}

export function isStepfunModel(model?: string | null): boolean {
  return STEPFUN_ALIASES.has((model ?? "").trim());
}

export function defaultLlmModel(upstream: LlmUpstreamMode): string {
  if (upstream === "openai") {
    return "gpt-4o-mini";
  }
  return DEEPSEEK_FLASH_MODEL;
}

/** Map public aliases onto official upstream ids. Unknown ids pass through. */
export function canonicalizeLlmModel(upstream: LlmUpstreamMode, model?: string | null): string {
  const requested = (model ?? "").trim();
  if (isStepfunModel(requested)) {
    return STEP_5_PREVIEW_MODEL;
  }
  if (isDeepseekAlias(requested)) {
    return DEEPSEEK_FLASH_MODEL;
  }
  if (upstream === "deepseek") {
    return requested || DEEPSEEK_FLASH_MODEL;
  }
  return requested || defaultLlmModel(upstream);
}

export function isDeepseekProModel(_model?: string | null): boolean {
  return false;
}

export function isDeepseekVisionModel(model?: string | null): boolean {
  return canonicalizeLlmModel("deepseek", model) === DEEPSEEK_FLASH_MODEL && !isStepfunModel(model);
}

export function isDeepseekFlashModel(model?: string | null): boolean {
  const requested = (model ?? "").trim();
  if (isStepfunModel(requested)) {
    return false;
  }
  return canonicalizeLlmModel("deepseek", requested) === DEEPSEEK_FLASH_MODEL;
}

export function deepseekModelLabel(_model?: string | null): string {
  return "DeepSeek Flash 4.1";
}

export function stepfunModelLabel(_model?: string | null): string {
  return STEP_5_PREVIEW_LABEL;
}

export function chatModelLabel(model?: string | null): string {
  const id = (model ?? "").trim();
  if (isStepfunModel(id)) {
    return STEP_5_PREVIEW_LABEL;
  }
  if (!id || isDeepseekAlias(id) || id === DEEPSEEK_FLASH_MODEL) {
    return "DeepSeek Flash 4.1";
  }
  if (/^gpt-|^o[1-9]|^chatgpt/i.test(id)) {
    return "OpenAI";
  }
  return id;
}

export function chatModelShortLabel(model?: string | null): string {
  const id = (model ?? "").trim();
  if (isStepfunModel(id)) {
    return "Step 5";
  }
  if (!id || isDeepseekAlias(id) || id === DEEPSEEK_FLASH_MODEL) {
    return "Flash";
  }
  if (/^gpt-|^o[1-9]|^chatgpt/i.test(id)) {
    return "GPT";
  }
  return id.length > 16 ? id.slice(0, 16) : id;
}

export function resolveDeepseekChatModel(model?: string | null, _hasImages = false): string {
  return canonicalizeLlmModel("deepseek", model);
}

export function resolvePublicChatModel(upstream?: string | null, model?: string | null): string {
  const requested = (model ?? "").trim();
  if (isStepfunModel(requested)) {
    return STEP_5_PREVIEW_MODEL;
  }
  if (isDeepseekAlias(requested)) {
    return DEEPSEEK_FLASH_MODEL;
  }
  if (upstream === "openai") {
    return requested && requested !== "mock" ? requested : "gpt-4o-mini";
  }
  if (requested && requested !== "mock") {
    return canonicalizeLlmModel("deepseek", requested);
  }
  return DEEPSEEK_FLASH_MODEL;
}

/** Picker value: catalog hit, else official id, else first catalog row. Never `mock`. */
export function resolveCatalogSelection(
  current?: string | null,
  models: ChatModelOption[] = CHAT_MODELS,
): string {
  const list = models.length > 0 ? models : CHAT_MODELS;
  const resolved = resolvePublicChatModel("deepseek", current);
  if (list.some((item) => item.id === resolved)) {
    return resolved;
  }
  if (resolved && resolved !== "mock") {
    return resolved;
  }
  return list[0]!.id;
}

export function isChatCatalogModel(model?: string | null): boolean {
  const id = (model ?? "").trim();
  return id.length > 0 && !NON_CHAT_MODEL.test(id);
}

export function decorateCatalogIds(ids: Array<string | null | undefined>): ChatModelOption[] {
  const seen = new Set<string>();
  const models: ChatModelOption[] = [];
  for (const raw of ids) {
    const canonical = canonicalizeLlmModel("deepseek", raw);
    if (!isChatCatalogModel(canonical) || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    models.push({ id: canonical, label: chatModelLabel(canonical) });
  }
  return models;
}

export function staticChatCatalog(): { models: ChatModelOption[]; modelsSource: LlmModelsSource } {
  return { models: CHAT_MODELS.map((item) => ({ ...item })), modelsSource: "static" };
}

/** V4.1 Flash and Step 5 are native multimodal; keep those ids. */
export function visionModelFor(model?: string | null): string {
  const id = (model ?? "").trim();
  if (!id) {
    return DEEPSEEK_FLASH_MODEL;
  }
  if (isStepfunModel(id)) {
    return STEP_5_PREVIEW_MODEL;
  }
  if (/^gpt-|^o[1-9]|^chatgpt/i.test(id)) {
    return id;
  }
  if (isDeepseekAlias(id) || canonicalizeLlmModel("deepseek", id) === DEEPSEEK_FLASH_MODEL) {
    return DEEPSEEK_FLASH_MODEL;
  }
  return id;
}
