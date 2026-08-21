export type UpstreamMode = "mock" | "openai";

export function getConfig() {
  const apiKey = process.env.LLM_UPSTREAM_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const explicit = process.env.LLM_UPSTREAM as UpstreamMode | undefined;
  return {
    port: Number(process.env.LLM_GATEWAY_PORT ?? 8081),
    jwtSecret: process.env.LLM_GATEWAY_JWT_SECRET ?? "dev-only-change-me",
    upstream: explicit ?? (apiKey ? "openai" : "mock"),
    upstreamBaseUrl: (process.env.LLM_UPSTREAM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    upstreamApiKey: apiKey,
    upstreamModel: process.env.LLM_UPSTREAM_MODEL ?? "gpt-4o-mini",
  };
}
