import type { ExpertPick } from "@neo-cloud-agent/contracts/expert";
import type { AgentMode, CreateRunRequest, ImageRef, RunSource } from "@neo-cloud-agent/contracts/run";
import { MAX_IMAGES } from "./images.js";
import { CLOUD_TARGET } from "./place.js";

/** Web sends this so the agent reads without touching the workspace. Mobile matches it verbatim. */
export const ASK_PREFIX = "只阅读和回答，不要修改文件或执行会改状态的命令。\n\n";

export function askPrompt(text: string, mode?: AgentMode): string {
  return mode === "ask" ? `${ASK_PREFIX}${text}` : text;
}

export function cloudRunRequest(input: {
  prompt: string;
  source: Extract<RunSource, "ios" | "android">;
  envId?: string;
  model?: string;
  expert?: ExpertPick;
  pluginIds?: string[];
  projectId?: string;
  mode?: AgentMode;
  images?: ImageRef[];
}): CreateRunRequest {
  // A run takes an expert or a team, never both; the control plane rejects the pair.
  const expertTeamId = input.expert?.expertTeamId || undefined;
  const expertId = expertTeamId ? undefined : input.expert?.expertId || undefined;
  const images = input.images?.length ? input.images.slice(0, MAX_IMAGES) : undefined;
  return {
    prompt: askPrompt(input.prompt, input.mode) || "（图片）",
    repoUrls: [],
    envId: input.envId || undefined,
    source: input.source,
    model: input.model,
    expertId,
    expertTeamId,
    pluginIds: input.pluginIds?.length ? input.pluginIds : undefined,
    projectId: input.projectId || undefined,
    mode: input.mode,
    images,
    target: { ...CLOUD_TARGET },
  };
}

/** Follow-ups take the same cloud field, capped the same way. */
export function cloudFollowUp(input: { text: string; mode?: AgentMode; images?: ImageRef[] }): {
  text: string;
  images?: ImageRef[];
} {
  return {
    text: askPrompt(input.text, input.mode) || "（图片）",
    images: input.images?.length ? input.images.slice(0, MAX_IMAGES) : undefined,
  };
}
