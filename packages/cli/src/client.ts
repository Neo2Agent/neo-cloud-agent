import type {
  Build,
  CreateFollowUpRequest,
  CreateRunRequest,
  Environment,
  FollowUp,
  PublicLlmSettings,
  Run,
  RunDiagnostics,
  RunEvent,
  TranscriptSnapshot,
} from "@neo-cloud-agent/contracts";
import { CliError, EXIT_ERROR, EXIT_NETWORK, EXIT_USAGE } from "./errors.js";
import { streamSse } from "./sse.js";

export interface ControlPlaneClientOptions {
  url: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface HealthInfo {
  ok?: boolean;
  service?: string;
  defaultModel?: string;
  llmConfigured?: boolean;
  workerRuntime?: string;
  authRequired?: boolean;
  accountsRequired?: boolean;
  [key: string]: unknown;
}

export interface MeInfo {
  user: { id: string; email: string; orgId: string } | null;
  actor: string;
}

export interface TranscriptResponse {
  events: RunEvent[];
  snapshot: TranscriptSnapshot;
}

export interface RunDiff {
  branch: string | null;
  baseBranch: string | null;
  pullRequests: Run["pullRequests"];
  [key: string]: unknown;
}

export class ControlPlaneClient {
  readonly url: string;
  readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ControlPlaneClientOptions) {
    this.url = options.url.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  headers(json = false, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (json) {
      headers["content-type"] = "application/json";
    }
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  async request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        method,
        headers: this.headers(body !== undefined, init?.headers as Record<string, string> | undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: init?.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "network_error";
      throw new CliError(`cannot reach ${this.url}: ${message}`, EXIT_NETWORK);
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
      const code = response.status === 401 || response.status === 400 ? EXIT_USAGE : EXIT_ERROR;
      throw new CliError(err || `http ${response.status}`, code, response.status);
    }
    return parsed as T;
  }

  health(): Promise<HealthInfo> {
    return this.request<HealthInfo>("GET", "/health");
  }

  me(): Promise<MeInfo> {
    return this.request<MeInfo>("GET", "/v1/me");
  }

  loginAccount(email: string, password: string): Promise<{ token: string; user: { email: string } }> {
    return this.request("POST", "/v1/auth/login", { email, password });
  }

  verifyApiToken(token: string): Promise<{ ok: boolean; authRequired?: boolean }> {
    return this.request("POST", "/v1/auth", { token });
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request("POST", "/v1/auth/logout", {});
  }

  llmSettings(): Promise<PublicLlmSettings> {
    return this.request("GET", "/v1/settings/llm");
  }

  createRun(input: CreateRunRequest): Promise<Run> {
    return this.request<Run>("POST", "/v1/runs", input);
  }

  listRuns(): Promise<{ runs: Run[] }> {
    return this.request("GET", "/v1/runs");
  }

  getRun(id: string): Promise<Run> {
    return this.request<Run>("GET", `/v1/runs/${id}`);
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

  diagnostics(id: string): Promise<RunDiagnostics> {
    return this.request("GET", `/v1/runs/${id}/diagnostics`);
  }

  diff(id: string): Promise<RunDiff> {
    return this.request("GET", `/v1/runs/${id}/diff`);
  }

  commit(id: string, message: string, paths?: string[]): Promise<unknown> {
    return this.request("POST", `/v1/runs/${id}/commit`, { message, paths });
  }

  openPr(id: string, title: string, body?: string): Promise<unknown> {
    return this.request("POST", `/v1/runs/${id}/pull-request`, { title, body });
  }

  listEnvironments(): Promise<{ environments: Environment[] }> {
    return this.request("GET", "/v1/environments");
  }

  getEnvironment(id: string): Promise<Environment> {
    return this.request("GET", `/v1/environments/${id}`);
  }

  listBuilds(): Promise<{ builds: Build[] }> {
    return this.request("GET", "/v1/builds");
  }

  vms(): Promise<unknown> {
    return this.request("GET", "/v1/vms");
  }

  streamEvents(
    id: string,
    onEvent: (event: RunEvent) => void,
    options?: { after?: string | null; signal?: AbortSignal },
  ): Promise<void> {
    const query = options?.after ? `?after=${encodeURIComponent(options.after)}` : "";
    return streamSse(
      `${this.url}/v1/runs/${id}/events${query}`,
      this.headers(false, {
        accept: "text/event-stream",
        ...(options?.after ? { "Last-Event-ID": options.after } : {}),
      }),
      onEvent,
      options?.signal,
    );
  }
}
