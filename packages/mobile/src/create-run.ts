import type { ExpertPick } from "@neo-cloud-agent/contracts/expert";
import type { CreateRunRequest, FollowUpDelivery, ImageRef, RunSource } from "@neo-cloud-agent/contracts/run";
import { MAX_IMAGES } from "./images.js";
import { CLOUD_TARGET } from "./place.js";

export function cloudRunRequest(input: {
  prompt: string;
  source: Extract<RunSource, "ios" | "android">;
  envId?: string;
  model?: string;
  expert?: ExpertPick;
  pluginIds?: string[];
  projectId?: string;
  images?: ImageRef[];
}): CreateRunRequest {
  // A run takes an expert or a team, never both; the control plane rejects the pair.
  const expertTeamId = input.expert?.expertTeamId || undefined;
  const expertId = expertTeamId ? undefined : input.expert?.expertId || undefined;
  const images = input.images?.length ? input.images.slice(0, MAX_IMAGES) : undefined;
  return {
    prompt: input.prompt || "（图片）",
    repoUrls: [],
    envId: input.envId || undefined,
    source: input.source,
    model: input.model,
    expertId,
    expertTeamId,
    pluginIds: input.pluginIds?.length ? input.pluginIds : undefined,
    projectId: input.projectId || undefined,
    images,
    target: { ...CLOUD_TARGET },
  };
}

/** Follow-ups take the same cloud field, capped the same way. `delivery` is set while a turn runs. */
export function cloudFollowUp(input: { text: string; images?: ImageRef[]; delivery?: FollowUpDelivery }): {
  text: string;
  images?: ImageRef[];
  delivery?: FollowUpDelivery;
} {
  return {
    text: input.text || "（图片）",
    images: input.images?.length ? input.images.slice(0, MAX_IMAGES) : undefined,
    ...(input.delivery ? { delivery: input.delivery } : {}),
  };
}
