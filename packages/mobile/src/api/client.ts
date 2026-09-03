import type { Automation, CreateAutomationRequest } from "@neo-cloud-agent/contracts/automation";
import type { CreateDeviceRequest, Device } from "@neo-cloud-agent/contracts/device";
import type { RunDiagnostics } from "@neo-cloud-agent/contracts/diagnostics";
import type { Environment } from "@neo-cloud-agent/contracts/environment";
import type { RunEvent, TranscriptSnapshot } from "@neo-cloud-agent/contracts/events";
import type { Desk } from "@neo-cloud-agent/contracts/desk";
import type { CreateExpertRequest, Expert, ExpertTeam, UpdateExpertRequest } from "@neo-cloud-agent/contracts/expert";
import type { MemoryItem, MemoryListResponse } from "@neo-cloud-agent/contracts/memory";
import type { PluginCatalogItem, PluginInstall, PluginInstallScope } from "@neo-cloud-agent/contracts/plugin";
import type {
  CreateProjectRequest,
  Project,
  ProjectInvite,
  UpdateProjectRequest,
} from "@neo-cloud-agent/contracts/project";
import type { CreateProjectAssetRequest, ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import type { InboxItem } from "@neo-cloud-agent/contracts/project-message";
import type { CreateFollowUpRequest, CreateRunRequest, FollowUp, Run } from "@neo-cloud-agent/contracts/run";
import { DEFAULT_TRANSCRIPT_PAGE } from "@neo-cloud-agent/contracts/transcript";

import { readSseEvents, shouldUseXhrSse, streamSseWithXhr } from "./sse.js";

export type PublicLlmSettings = {
  configured: boolean;
  upstream: string;
  model: string | null;
  baseUrl: string | null;
};

/** `GET /v1/runs/:id/artifacts`. `url` is already signed, so it needs no Bearer. */
export type RunArtifact = {
  name: string;
  size?: number;
  contentType?: string;
  url?: string;
};

/** `GET /v1/quota`. Read-only on mobile; limits are written from the web settings page. */
export type QuotaView = {
  maxTokensMonth: number;
  maxConcurrentRuns: number;
  usedTokensMonth: number;
  concurrentRuns: number;
  remainingTokens: number | null;
  remainingConcurrent: number | null;
};

/** `GET /v1/vms`. Mobile only uses this to explain why a run sits in `queued`. */
export type VmSlotsView = {
  runtime: string;
  backend: string;
  total: number;
  busy: number;
  slots: Array<{ id: string; status: string; runId?: string | null }>;
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
  return `连不上 ${host}。浏览器能开、App 不能时，多半是安卓拦了 HTTP。请装带明文网络的新包，或改填 https://neorun.cloud。`;
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

  /** Artifact urls come back relative, and the API base is user-configurable on device. */
  absoluteUrl(path: string): string {
    return /^https?:\/\//.test(path) ? path : this.resolve(path);
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

  login(email: string, password: string): Promise<{ token: string; user: { id?: string; email: string; phone?: string | null } }> {
    return this.request("POST", "/v1/auth/login", { email, password });
  }

  register(input: {
    username: string;
    phone: string;
    password: string;
  }): Promise<{
    token?: string;
    pending?: boolean;
    message?: string;
    user: { id?: string; email: string; phone?: string | null };
  }> {
    return this.request("POST", "/v1/auth/register", input);
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

  speechStatus(): Promise<{ configured: boolean }> {
    return this.request("GET", "/v1/speech/iat");
  }

  speechIat(body: { sessionId?: string; audio?: string; status: 0 | 1 | 2 }): Promise<{
    sessionId: string;
    text: string;
    done?: boolean;
    error?: string;
  }> {
    return this.request("POST", "/v1/speech/iat", body);
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

  deleteRun(id: string): Promise<{ ok: boolean; id: string; deletedAt: string }> {
    return this.request("DELETE", `/v1/runs/${id}`);
  }

  transcript(id: string, options?: { limit?: number; before?: string }): Promise<TranscriptResponse> {
    const query = new URLSearchParams({
      limit: String(options?.limit ?? DEFAULT_TRANSCRIPT_PAGE),
      images: "href",
    });
    if (options?.before) query.set("before", options.before);
    return this.request("GET", `/v1/runs/${id}/transcript?${query.toString()}`);
  }

  listArtifacts(id: string): Promise<{ artifacts: RunArtifact[] }> {
    return this.request("GET", `/v1/runs/${id}/artifacts`);
  }

  /** Only project runs can save; the control plane rejects the rest with 400. */
  saveArtifactToProject(id: string, name: string, assetPath?: string): Promise<ProjectAsset> {
    return this.request("POST", `/v1/runs/${id}/artifacts/${encodeURIComponent(name)}/save-to-project`,
      assetPath ? { path: assetPath } : {});
  }

  diagnostics(id: string): Promise<RunDiagnostics> {
    return this.request("GET", `/v1/runs/${id}/diagnostics`);
  }

  transferRun(id: string, input: { toUserId: string; note?: string }): Promise<Run> {
    return this.request("POST", `/v1/runs/${id}/transfer`, input);
  }

  listMemories(limit?: number): Promise<MemoryListResponse> {
    const query = limit ? `?limit=${limit}` : "";
    return this.request("GET", `/v1/memories${query}`);
  }

  addMemory(text: string): Promise<{ memories: MemoryItem[] }> {
    return this.request("POST", "/v1/memories", { text });
  }

  deleteMemory(id: string): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/v1/memories/${encodeURIComponent(id)}`);
  }

  listInbox(): Promise<{ items: InboxItem[]; unread: number }> {
    return this.request("GET", "/v1/inbox");
  }

  markInboxRead(id: string): Promise<{ ok: boolean; unread: number }> {
    return this.request("POST", `/v1/inbox/${encodeURIComponent(id)}/read`, {});
  }

  quota(): Promise<QuotaView> {
    return this.request("GET", "/v1/quota");
  }

  listVms(): Promise<VmSlotsView> {
    return this.request("GET", "/v1/vms");
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

  listPlugins(projectId?: string): Promise<{ plugins: PluginCatalogItem[] }> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return this.request("GET", `/v1/plugins${query}`);
  }

  installPlugin(id: string, input: { scope: PluginInstallScope; projectId?: string }): Promise<PluginInstall> {
    return this.request("POST", `/v1/plugins/${id}/install`, input);
  }

  uninstallPlugin(id: string, input: { scope: PluginInstallScope; projectId?: string }): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/v1/plugins/${id}/install`, input);
  }

  enablePlugin(
    id: string,
    input: { enabled: boolean; scope: PluginInstallScope; projectId?: string },
  ): Promise<PluginInstall> {
    return this.request("POST", `/v1/plugins/${id}/enable`, input);
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

  updateProject(id: string, input: UpdateProjectRequest): Promise<Project> {
    return this.request("POST", `/v1/projects/${id}`, input);
  }

  listProjectAssets(id: string): Promise<{ assets: ProjectAsset[] }> {
    return this.request("GET", `/v1/projects/${id}/assets`);
  }

  createProjectAsset(id: string, input: CreateProjectAssetRequest): Promise<ProjectAsset> {
    return this.request("POST", `/v1/projects/${id}/assets`, input);
  }

  deleteProjectAsset(id: string, assetId: string): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/v1/projects/${id}/assets/${assetId}`);
  }

  /** Assets stream bytes rather than JSON, and unlike artifacts they need the Bearer header. */
  async downloadProjectAsset(id: string, assetId: string): Promise<{ contentType: string; body: ArrayBuffer }> {
    const path = `/v1/projects/${id}/assets/${assetId}`;
    let response: Response;
    try {
      response = await this.fetchImpl(this.resolve(path), { method: "GET", headers: this.headers() });
    } catch (error) {
      throw new MobileApiError(describeNetworkError(error, this.resolve(path)), 0);
    }
    if (!response.ok) {
      throw new MobileApiError(`asset ${response.status}`, response.status);
    }
    return {
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      body: await response.arrayBuffer(),
    };
  }

  /** Same body as the web project page: an account, plus a password when it is new. */
  addProjectMember(
    id: string,
    input: { email: string; password?: string; role?: "admin" | "member" },
  ): Promise<Project> {
    return this.request("POST", `/v1/projects/${id}/members`, input);
  }

  createProjectInvite(id: string): Promise<ProjectInvite & { url?: string }> {
    return this.request("POST", `/v1/projects/${id}/invites`, {});
  }

  approveProjectInvite(id: string, token: string): Promise<Project> {
    return this.request("POST", `/v1/projects/${id}/invites/${encodeURIComponent(token)}/approve`, {});
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
