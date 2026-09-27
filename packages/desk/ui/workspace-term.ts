import { createWorkspaceTermApi } from "@neo-cloud-agent/ui/workspace-term";
import { api } from "./api";
import { withApiBase } from "./desk";

export type { WorkspaceTermEvent, WorkspaceTermInfo } from "@neo-cloud-agent/ui/workspace-term";
export { parseTermSseData } from "@neo-cloud-agent/ui/workspace-term";

const termApis = new Map<string, ReturnType<typeof createWorkspaceTermApi>>();

function termApi(token: string) {
  const current = termApis.get(token);
  if (current) return current;
  const created = createWorkspaceTermApi({
    request: (path, init) => api(token, path, init),
    eventsUrl: (path) => {
      const params = new URLSearchParams();
      if (token) params.set("access_token", token);
      const query = params.toString() ? `?${params}` : "";
      return withApiBase(`${path}${query}`);
    },
  });
  termApis.set(token, created);
  return created;
}

export function listWorkspaceTerms(token: string, runId: string) {
  return termApi(token).listWorkspaceTerms(runId);
}

export function openWorkspaceTerm(token: string, runId: string) {
  return termApi(token).openWorkspaceTerm(runId);
}

export function ensureWorkspaceTerms(token: string, runId: string) {
  return termApi(token).ensureWorkspaceTerms(runId);
}

export function writeWorkspaceTerm(token: string, runId: string, id: string, data: string) {
  return termApi(token).writeWorkspaceTerm(runId, id, data);
}

export function closeWorkspaceTerm(token: string, runId: string, id: string) {
  return termApi(token).closeWorkspaceTerm(runId, id);
}

export function subscribeWorkspaceTerm(
  token: string,
  runId: string,
  id: string,
  onEvent: Parameters<ReturnType<typeof createWorkspaceTermApi>["subscribeWorkspaceTerm"]>[3],
) {
  return termApi(token).subscribeWorkspaceTerm(runId, id, token, onEvent);
}
