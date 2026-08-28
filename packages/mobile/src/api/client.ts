import type { CreateDeviceRequest, Device } from "@neo-cloud-agent/contracts/device";
import type { Environment } from "@neo-cloud-agent/contracts/environment";
import type { RunEvent, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Desk } from "@neo-cloud-agent/contracts/desk";
import type { CreateFollowUpRequest, CreateRunRequest, FollowUp, Run } from "@neo-cloud-agent/contracts/run";

import { readSseEvents } from "./sse.js";

export type PublicLlmSettings = {
  configured: boolean;
  upstream: string;
  model: string | null;
  baseUrl: string | null;
};

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface TranscriptResponse {
  events?: RunEvent[];
  snapshot: TranscriptSnapshot;
}

export class MobileClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    readonly url: string,
    readonly token: string,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  headers(json = false, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (json) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return headers;
  }

  private resolve(path: string): string {
    if (!this.url) return path;
    return `${this.url.replace(/\/$/, "")}${path}`;
  }

  async request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.resolve(path), {
        method,
        headers: this.headers(body !== undefined, init?.headers as Record<string, string> | undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: init?.signal,
      });
    } catch (error) {
      throw new MobileApiError(error instanceof Error ? error.message : "network_error", 0);
    }
    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { error: text };
      }
    }
    if (!response.ok) {
      const err = (parsed as { error?: string } | undefined)?.error ?? response.statusText;
      throw new MobileApiError(err || `http ${response.status}`, response.status);
    }
    return parsed as T;
  }

  login(email: string, password: string): Promise<{ token: string; user: { id?: string; email: string } }> {
    return this.request("POST", "/v1/auth/login", { email, password });
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request("POST", "/v1/auth/logout", {});
  }

  me(): Promise<{ user: { id: string; email: string; orgId: string } | null }> {
    return this.request("GET", "/v1/me");
  }

  llmSettings(): Promise<PublicLlmSettings> {
    return this.request("GET", "/v1/settings/llm");
  }

  listRuns(): Promise<{ runs: Run[] }> {
    return this.request("GET", "/v1/runs");
  }

  getRun(id: string): Promise<Run> {
    return this.request("GET", `/v1/runs/${id}`);
  }

  createRun(input: CreateRunRequest): Promise<Run> {
    return this.request("POST", "/v1/runs", input);
  }

  followUp(id: string, input: CreateFollowUpRequest): Promise<FollowUp> {
    return this.request("POST", `/v1/runs/${id}/follow-ups`, input);
  }

  abort(id: string): Promise<Run> {
    return this.request("POST", `/v1/runs/${id}/abort`, {});
  }

  archive(id: string): Promise<Run> {
    return this.request("POST", `/v1/runs/${id}/archive`, {});
  }

  transcript(id: string): Promise<TranscriptResponse> {
    return this.request("GET", `/v1/runs/${id}/transcript`);
  }

  listEnvironments(): Promise<{ environments: Environment[] }> {
    return this.request("GET", "/v1/environments");
  }

  listDesks(): Promise<{ desks: Desk[] }> {
    return this.request("GET", "/v1/desks");
  }

  registerDevice(input: CreateDeviceRequest): Promise<Device> {
    return this.request("POST", "/v1/devices", input);
  }

  listDevices(): Promise<{ devices: Device[] }> {
    return this.request("GET", "/v1/devices");
  }

  deleteDevice(id: string): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/v1/devices/${id}`);
  }

  async streamEvents(
    id: string,
    onEvent: (event: RunEvent) => void,
    options?: { after?: string | null; signal?: AbortSignal },
  ): Promise<void> {
    const query = options?.after ? `?after=${encodeURIComponent(options.after)}` : "";
    const response = await this.fetchImpl(this.resolve(`/v1/runs/${id}/events${query}`), {
      method: "GET",
      headers: this.headers(false, {
        accept: "text/event-stream",
        ...(options?.after ? { "Last-Event-ID": options.after } : {}),
      }),
      signal: options?.signal,
    });
    if (!response.ok) {
      throw new MobileApiError(`sse ${response.status}`, response.status);
    }
    for await (const event of readSseEvents<RunEvent>(response)) {
      onEvent(event);
    }
  }
}
