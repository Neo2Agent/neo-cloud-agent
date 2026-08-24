import { isDeepseekVisionModel, resolveModelLimits } from "@neo-cloud-agent/contracts";

export function publicModelId(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/")[1]! : modelId;
}

/** Limits we register with pi. Unknown models get no invented window. */
export function supportsVision(modelId: string): boolean {
  const id = publicModelId(modelId);
  return isDeepseekVisionModel(id) || /^gpt-4o|^gpt-4\.1|^chatgpt-4o|^o[1-9]/i.test(id);
}

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
