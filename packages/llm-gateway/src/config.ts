import { canonicalizeLlmModel, DEEPSEEK_FLASH_MODEL, readLlmSettings, type LlmUpstreamMode } from "@neo-cloud-agent/contracts";
import { loadRootEnv } from "./env.js";

loadRootEnv();

export type UpstreamMode = LlmUpstreamMode;

const PRESETS: Record<Exclude<UpstreamMode, "mock">, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: DEEPSEEK_FLASH_MODEL },
};

export function getConfig(settingsRoot?: string) {
  const saved = readLlmSettings(settingsRoot);
  const usingSaved = Boolean(saved?.apiKey && saved.upstream !== "mock");
  const envDeepseek =
    process.env.LLM_UPSTREAM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || "";
  const envOpenai =
    process.env.LLM_UPSTREAM_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
  const explicit = (usingSaved ? saved?.upstream : (saved?.upstream ?? process.env.LLM_UPSTREAM)) as
    | UpstreamMode
    | undefined;
  const upstream: UpstreamMode =
    explicit ?? (envDeepseek && !process.env.OPENAI_API_KEY ? "deepseek" : envOpenai ? "openai" : "mock");
  const preset = upstream === "mock" ? PRESETS.openai : PRESETS[upstream];
  const apiKey = usingSaved
    ? saved!.apiKey
    : upstream === "deepseek"
      ? envDeepseek || envOpenai
      : envOpenai || envDeepseek;
  return {
    port: Number(process.env.LLM_GATEWAY_PORT ?? 8081),
    jwtSecret: process.env.LLM_GATEWAY_JWT_SECRET ?? "dev-only-change-me",
    upstream,
    upstreamBaseUrl: (
      usingSaved
        ? saved?.baseUrl || preset.baseUrl
        : (process.env.LLM_UPSTREAM_BASE_URL ?? preset.baseUrl)
    ).replace(/\/$/, ""),
    upstreamApiKey: apiKey,
    upstreamModel: canonicalizeLlmModel(
      upstream,
      usingSaved ? saved?.model || preset.model : process.env.LLM_UPSTREAM_MODEL || preset.model,
    ),
    configured: upstream !== "mock" && Boolean(apiKey),
  };
}
