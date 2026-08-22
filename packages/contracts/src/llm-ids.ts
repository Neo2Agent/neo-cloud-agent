export type LlmUpstreamMode = "mock" | "openai" | "deepseek";

export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";

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
