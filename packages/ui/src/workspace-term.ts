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

export type WorkspaceTermTransport = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  eventsUrl: (path: string) => string;
};

const TERM_READ_FAILED = "读取终端失败";
const TERM_OPEN_FAILED = "打不开终端";
const TERM_WRITE_FAILED = "写入失败";
const TERM_CLOSE_FAILED = "关闭失败";

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
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

export function createWorkspaceTermApi(transport: WorkspaceTermTransport) {
  const ensureLocks = new Map<string, Promise<WorkspaceTermInfo[]>>();
  const liveTerms = new Map<string, { source: EventSource; listeners: Set<(event: WorkspaceTermEvent) => void> }>();

  async function listWorkspaceTerms(runId: string): Promise<WorkspaceTermInfo[]> {
    const response = await transport.request(`/v1/runs/${runId}/term`);
    const body = await readJson<{ sessions?: WorkspaceTermInfo[]; error?: string }>(response);
    if (!response.ok) {
      throw new Error(body.error || TERM_READ_FAILED);
    }
    return body.sessions ?? [];
  }

  async function openWorkspaceTerm(runId: string): Promise<WorkspaceTermInfo> {
    const response = await transport.request(`/v1/runs/${runId}/term`, { method: "POST" });
    const body = await readJson<WorkspaceTermInfo & { error?: string }>(response);
    if (!response.ok) {
      throw new Error(body.error || TERM_OPEN_FAILED);
    }
    return body;
  }

  function ensureWorkspaceTerms(runId: string): Promise<WorkspaceTermInfo[]> {
    const current = ensureLocks.get(runId);
    if (current) return current;
    const next = (async () => {
      const existing = await listWorkspaceTerms(runId);
      if (existing.length > 0) return existing;
      return [await openWorkspaceTerm(runId)];
    })().finally(() => {
      if (ensureLocks.get(runId) === next) ensureLocks.delete(runId);
    });
    ensureLocks.set(runId, next);
    return next;
  }

  async function writeWorkspaceTerm(runId: string, id: string, data: string): Promise<void> {
    const response = await transport.request(`/v1/runs/${runId}/term/${id}`, {
      method: "POST",
      body: JSON.stringify({ data }),
    });
    if (!response.ok) {
      const body = await readJson<{ error?: string }>(response);
      throw new Error(body.error || TERM_WRITE_FAILED);
    }
  }

  async function closeWorkspaceTerm(runId: string, id: string): Promise<void> {
    const response = await transport.request(`/v1/runs/${runId}/term/${id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      const body = await readJson<{ error?: string }>(response);
      throw new Error(body.error || TERM_CLOSE_FAILED);
    }
  }

  function subscribeWorkspaceTerm(
    runId: string,
    id: string,
    token: string,
    onEvent: (event: WorkspaceTermEvent) => void,
  ): () => void {
    const key = `${runId}\0${id}\0${token}`;
    let live = liveTerms.get(key);
    if (!live) {
      const source = new EventSource(transport.eventsUrl(`/v1/runs/${runId}/term/${id}/events`));
      const created = { source, listeners: new Set<(event: WorkspaceTermEvent) => void>() };
      source.onmessage = (message) => {
        const event = parseTermSseData(message.data);
        if (!event) return;
        for (const listener of created.listeners) listener(event);
      };
      liveTerms.set(key, created);
      live = created;
    }
    live.listeners.add(onEvent);
    return () => {
      live.listeners.delete(onEvent);
      if (live.listeners.size === 0) {
        live.source.close();
        liveTerms.delete(key);
      }
    };
  }

  return {
    listWorkspaceTerms,
    openWorkspaceTerm,
    ensureWorkspaceTerms,
    writeWorkspaceTerm,
    closeWorkspaceTerm,
    subscribeWorkspaceTerm,
  };
}
