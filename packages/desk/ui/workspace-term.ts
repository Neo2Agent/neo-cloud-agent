import { api, readJson } from "./api";
import { withApiBase } from "./desk";

export type WorkspaceTermInfo = {
  id: string;
  cwd: string;
  shell: string;
  alive?: boolean;
  pty?: boolean;
};

export type WorkspaceTermEvent =
  | { type: "ready"; id: string; cwd: string; shell: string }
  | { type: "data"; chunk: string }
  | { type: "exit"; code: number | null };

export async function listWorkspaceTerms(token: string, runId: string): Promise<WorkspaceTermInfo[]> {
  const response = await api(token, `/v1/runs/${runId}/term`);
  const body = await readJson<{ sessions?: WorkspaceTermInfo[]; error?: string }>(response);
  if (!response.ok) {
    throw new Error(body.error || "读取终端失败");
  }
  return body.sessions ?? [];
}

export async function openWorkspaceTerm(token: string, runId: string): Promise<WorkspaceTermInfo> {
  const response = await api(token, `/v1/runs/${runId}/term`, { method: "POST" });
  const body = await readJson<WorkspaceTermInfo & { error?: string }>(response);
  if (!response.ok) {
    throw new Error(body.error || "打不开终端");
  }
  return body;
}

export async function writeWorkspaceTerm(token: string, runId: string, id: string, data: string): Promise<void> {
  const response = await api(token, `/v1/runs/${runId}/term/${id}`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
  if (!response.ok) {
    const body = await readJson<{ error?: string }>(response);
    throw new Error(body.error || "写入失败");
  }
}

export async function closeWorkspaceTerm(token: string, runId: string, id: string): Promise<void> {
  const response = await api(token, `/v1/runs/${runId}/term/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const body = await readJson<{ error?: string }>(response);
    throw new Error(body.error || "关闭失败");
  }
}

export function parseTermSseData(raw: string): WorkspaceTermEvent | null {
  try {
    const parsed = JSON.parse(raw) as WorkspaceTermEvent;
    if (parsed && (parsed.type === "ready" || parsed.type === "data" || parsed.type === "exit")) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function subscribeWorkspaceTerm(
  token: string,
  runId: string,
  id: string,
  onEvent: (event: WorkspaceTermEvent) => void,
): () => void {
  const params = new URLSearchParams();
  if (token) {
    params.set("access_token", token);
  }
  const query = params.toString() ? `?${params}` : "";
  const source = new EventSource(withApiBase(`/v1/runs/${runId}/term/${id}/events${query}`));
  source.onmessage = (message) => {
    const event = parseTermSseData(message.data);
    if (event) {
      onEvent(event);
    }
  };
  return () => source.close();
}

const ensureLocks = new Map<string, Promise<WorkspaceTermInfo[]>>();

export function ensureWorkspaceTerms(token: string, runId: string): Promise<WorkspaceTermInfo[]> {
  const current = ensureLocks.get(runId);
  if (current) {
    return current;
  }
  const next = (async () => {
    const existing = await listWorkspaceTerms(token, runId);
    if (existing.length > 0) {
      return existing;
    }
    return [await openWorkspaceTerm(token, runId)];
  })().finally(() => {
    if (ensureLocks.get(runId) === next) {
      ensureLocks.delete(runId);
    }
  });
  ensureLocks.set(runId, next);
  return next;
}
