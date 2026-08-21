import { canonicalizeLlmModel, DEEPSEEK_FLASH_MODEL, DEEPSEEK_PRO_MODEL } from "@neo-cloud-agent/contracts";

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
    "deepseek-chat": DEEPSEEK_FLASH_MODEL,
    "deepseek-reasoner": DEEPSEEK_FLASH_MODEL,
    "deepseek-flash": DEEPSEEK_FLASH_MODEL,
    "deepseek-v4-flash": DEEPSEEK_FLASH_MODEL,
    "deepseek-pro": DEEPSEEK_PRO_MODEL,
    "deepseek-v4-pro": DEEPSEEK_PRO_MODEL,
    "neo/gpt": process.env.LLM_UPSTREAM_GPT_MODEL ?? "gpt-4o",
  };
  const mapped = routes[requested] ?? fallback;
  const upstream = /^gpt-|^o[1-9]|^chatgpt/i.test(mapped) ? "openai" : "deepseek";
  return canonicalizeLlmModel(upstream, mapped);
}
