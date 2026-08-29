import type { Automation, CreateAutomationRequest } from "@neo-cloud-agent/contracts/automation";
import type { CreateDeviceRequest, Device } from "@neo-cloud-agent/contracts/device";
import type { Environment } from "@neo-cloud-agent/contracts/environment";
import type { RunEvent, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Desk } from "@neo-cloud-agent/contracts/desk";
import type { CreateExpertRequest, Expert, ExpertTeam, UpdateExpertRequest } from "@neo-cloud-agent/contracts/expert";
import type { PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import type { CreateProjectRequest, Project } from "@neo-cloud-agent/contracts/project";
import type { CreateFollowUpRequest, CreateRunRequest, FollowUp, Run } from "@neo-cloud-agent/contracts/run";

import { readSseEvents, shouldUseXhrSse, streamSseWithXhr } from "./sse.js";

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

export function describeNetworkError(error: unknown, url: string): string {
  const raw = error instanceof Error ? error.message : "network_error";
  if (!/network request failed|failed to fetch|network_error/i.test(raw)) return raw;
  const host = url.replace(/\/v1\/.*$/, "") || url;
  return `连不上 ${host}。手机浏览器能开页面，但 App 请求到不了接口。可改填电脑局域网 http://IP:8080（不要 127.0.0.1）。`;
}

export interface TranscriptResponse {
  events?: RunEvent[];
  snapshot: TranscriptSnapshot;
}

export class MobileClient {
  private readonly fetchImpl: typeof fetch;
  private readonly injectedFetch: boolean;

  constructor(
    readonly url: string,
    readonly token: string,
    fetchImpl?: typeof fetch,
  ) {
    this.injectedFetch = Boolean(fetchImpl);
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  headers(json = false, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 NeoMobile/0.1",
      ...extra,
    };
    if (json) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return headers;
  }

  private resolve(path: string): string {
    // Never append `?client=desk` or send `X-Neo-Client: desk`. Mobile uses the
    // default control-plane visibility: cloud runs plus Desk Remote Control.
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
      throw new MobileApiError(describeNetworkError(error, this.resolve(path)), 0);
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

  me(): Promise<{ user: { id: string; email: string; orgId?: string; avatar?: string | null; neoAvatar?: string | null } | null }> {
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

  listExperts(): Promise<{ experts: Expert[] }> {
    return this.request("GET", "/v1/experts");
  }

  listPlugins(): Promise<{ plugins: PluginCatalogItem[] }> {
    return this.request("GET", "/v1/plugins");
  }

  listProjects(): Promise<{ projects: Project[] }> {
    return this.request("GET", "/v1/projects");
  }

  getProject(id: string): Promise<Project> {
    return this.request("GET", `/v1/projects/${id}`);
  }

  createProject(input: CreateProjectRequest): Promise<Project> {
    return this.request("POST", "/v1/projects", input);
  }

  listAutomations(): Promise<{ automations: Automation[] }> {
    return this.request("GET", "/v1/automations");
  }

  createAutomation(input: CreateAutomationRequest): Promise<Automation> {
    return this.request("POST", "/v1/automations", input);
  }

  updateAutomation(id: string, input: { enabled?: boolean }): Promise<Automation> {
    return this.request("POST", `/v1/automations/${id}`, input);
  }

  listExpertTeams(): Promise<{ teams: ExpertTeam[] }> {
    return this.request("GET", "/v1/expert-teams");
  }

  createExpert(input: CreateExpertRequest): Promise<Expert> {
    return this.request("POST", "/v1/experts", input);
  }

  updateExpert(id: string, input: UpdateExpertRequest): Promise<Expert> {
    return this.request("POST", `/v1/experts/${id}`, input);
  }

  deleteExpert(id: string): Promise<{ ok?: boolean }> {
    return this.request("DELETE", `/v1/experts/${id}`);
  }

  getInvite(token: string): Promise<{ projectName: string; status: string }> {
    return this.request("GET", `/v1/invites/${token}`);
  }

  acceptInvite(token: string): Promise<Project> {
    return this.request("POST", `/v1/invites/${token}`, {});
  }

  openPullRequest(id: string, title: string): Promise<{ pullRequest?: { url?: string } }> {
    return this.request("POST", `/v1/runs/${id}/pull-request`, { title });
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
    const path = `/v1/runs/${id}/events${query}`;
    const headers = this.headers(false, {
      accept: "text/event-stream",
      ...(options?.after ? { "Last-Event-ID": options.after } : {}),
    });
    // Expo fetch often buffers the whole SSE body. XHR onprogress paints tokens
    // as they arrive, the way Desk's EventSource does.
    if (!this.injectedFetch && shouldUseXhrSse()) {
      await streamSseWithXhr<RunEvent>(this.resolve(path), headers, onEvent, options?.signal);
      return;
    }
    const response = await this.fetchImpl(this.resolve(path), {
      method: "GET",
      headers,
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
