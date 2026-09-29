import type { TurnCompleteStatus } from "@neo-cloud-agent/contracts";

export type LoopEvent = {
  id: string;
  runId: string;
  createdAt: string;
  category: "agent_run";
  level: "info" | "error";
  kind: string;
  title: string;
  data: Record<string, unknown>;
};

export type ControlPlane = {
  emit(runId: string, events: LoopEvent[]): Promise<void>;
  heartbeat(runId: string, turnId: string, phase: string): Promise<void>;
  complete(
    runId: string,
    turnId: string,
    status: TurnCompleteStatus,
    errorMessage: string,
    cancelled: boolean,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<void>;
  loadSession(runId: string): Promise<Record<string, unknown>>;
  saveSession(runId: string, state: Record<string, unknown>): Promise<void>;
};

function trimSlash(url: string): string {
  return url.replace(/\/$/, "") || "http://127.0.0.1:8080";
}

export function createControlPlane(baseUrl: string, jwt: string): ControlPlane {
  const base = trimSlash(baseUrl);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${jwt}`,
  };

  async function post(path: string, body: unknown): Promise<void> {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`control-plane ${path} ${response.status} ${text}`);
    }
  }

  return {
    emit(runId, events) {
      if (events.length === 0) {
        return Promise.resolve();
      }
      return post(`/internal/runs/${runId}/events`, { events });
    },
    heartbeat(runId, turnId, phase) {
      return post(`/internal/runs/${runId}/turn-heartbeat`, { turnId, phase, stepId: "" });
    },
    complete(runId, turnId, status, errorMessage, cancelled, usage) {
      return post(`/internal/runs/${runId}/turn-complete`, {
        turnId,
        status,
        errorMessage,
        cancelled,
        usage,
      });
    },
    async loadSession(runId) {
      const response = await fetch(`${base}/internal/runs/${runId}/loop-session`, { headers });
      if (response.status === 404) {
        return {};
      }
      if (!response.ok) {
        return {};
      }
      const body = (await response.json()) as { state?: unknown };
      if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
        return {};
      }
      return body.state as Record<string, unknown>;
    },
    saveSession(runId, state) {
      return post(`/internal/runs/${runId}/loop-session`, { state });
    },
  };
}
