import type { Usage } from "@neo-cloud-agent/contracts";

export interface ProxyRequest {
  model: string;
  messages: unknown[];
}

export interface ProxyResult {
  id: string;
  model: string;
  stub: true;
  usage: Usage;
  message: string;
}

/**
 * P0: refuse to call providers until a real stream adapter is wired.
 * Provider keys stay in this process only.
 */
export async function proxyCompletion(input: ProxyRequest): Promise<ProxyResult> {
  return {
    id: `stub-${crypto.randomUUID()}`,
    model: input.model,
    stub: true,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    message: "llm-gateway is up. Wire a provider adapter before sending worker traffic.",
  };
}
