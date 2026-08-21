/** Map the public model id (what the Run stores) to an upstream model id. */
export function resolveUpstreamModel(requested: string, fallback: string): string {
  const routes: Record<string, string> = {
    "neo/sonnet": fallback,
    "neo-sonnet": fallback,
    sonnet: fallback,
    "neo/deepseek": fallback,
    "neo/ds": fallback,
    "neo-deepseek": fallback,
    ds: fallback,
    deepseek: fallback,
    "deepseek-chat": "deepseek-chat",
    "deepseek-reasoner": "deepseek-reasoner",
    "neo/gpt": process.env.LLM_UPSTREAM_GPT_MODEL ?? "gpt-4o",
  };
  return routes[requested] ?? fallback;
}
