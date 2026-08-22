import { resolveModelLimits } from "@neo-cloud-agent/contracts";

export function publicModelId(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[1]! : modelId;
}

/** Limits we register with pi. Unknown models get no invented window. */
export function gatewayModelSpec(modelId: string) {
  const limits = resolveModelLimits(modelId);
  return {
    id: publicModelId(modelId),
    name: modelId,
    contextWindow: limits?.contextWindow ?? 0,
    maxTokens: limits?.maxOutputTokens ?? 8192,
    compactionEnabled: Boolean(limits?.contextWindow),
  };
}
