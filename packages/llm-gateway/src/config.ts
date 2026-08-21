import { loadRootEnv } from "./env.js";

loadRootEnv();

export type UpstreamMode = "mock" | "openai" | "deepseek";

const PRESETS: Record<Exclude<UpstreamMode, "mock">, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
};

export function getConfig() {
  const deepseekKey = process.env.LLM_UPSTREAM_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? "";
  const openaiKey = process.env.LLM_UPSTREAM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const explicit = process.env.LLM_UPSTREAM as UpstreamMode | undefined;
  const upstream: UpstreamMode =
    explicit ?? (deepseekKey && !process.env.OPENAI_API_KEY ? "deepseek" : openaiKey ? "openai" : "mock");
  const preset = upstream === "mock" ? PRESETS.openai : PRESETS[upstream];
  const apiKey = upstream === "deepseek" ? deepseekKey || openaiKey : openaiKey || deepseekKey;
  return {
    port: Number(process.env.LLM_GATEWAY_PORT ?? 8081),
    jwtSecret: process.env.LLM_GATEWAY_JWT_SECRET ?? "dev-only-change-me",
    upstream,
    upstreamBaseUrl: (process.env.LLM_UPSTREAM_BASE_URL ?? preset.baseUrl).replace(/\/$/, ""),
    upstreamApiKey: apiKey,
    upstreamModel: process.env.LLM_UPSTREAM_MODEL ?? preset.model,
  };
}
