import { resolvePublicChatModel } from "@neo-cloud-agent/contracts/llm-ids";

export { formatDuration, toolArgPreview } from "@neo-cloud-agent/contracts/display";

export function resolveChatModel(upstream?: string | null, model?: string | null, _hasImages = false): string {
  return resolvePublicChatModel(upstream, model);
}
