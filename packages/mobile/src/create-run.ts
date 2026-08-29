import type { CreateRunRequest, RunSource } from "@neo-cloud-agent/contracts/run";
import { CLOUD_TARGET } from "./place.js";

export function cloudRunRequest(input: {
  prompt: string;
  source: Extract<RunSource, "ios" | "android">;
  envId?: string;
  model?: string;
  expertId?: string;
  pluginIds?: string[];
  projectId?: string;
}): CreateRunRequest {
  return {
    prompt: input.prompt,
    repoUrls: [],
    envId: input.envId || undefined,
    source: input.source,
    model: input.model,
    expertId: input.expertId || undefined,
    pluginIds: input.pluginIds?.length ? input.pluginIds : undefined,
    projectId: input.projectId || undefined,
    target: { ...CLOUD_TARGET },
  };
}
