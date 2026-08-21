export type EgressMode = "allow_all" | "default_plus_allowlist" | "allowlist_only";

export interface EgressPolicy {
  mode: EgressMode;
  domains?: string[];
}

export interface TerminalSpec {
  name: string;
  command: string;
}

export type McpTransport = "stdio" | "http";

/** MCP server started from environment.json. Tokens come from env / headers, not the VM's git credentials. */
export interface McpServerSpec {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Durable environment config. `install` must terminate.
 * `start` / `terminals` run on every VM boot.
 */
export interface EnvironmentJson {
  snapshot?: string;
  install?: string;
  start?: string;
  /** When true, a failed `start` blocks the agent (default: continue, Cursor-like). */
  startMustSucceed?: boolean;
  terminals?: TerminalSpec[];
  repos?: string[];
  egress?: EgressPolicy;
  mcp?: McpServerSpec[];
}

export function parseEnvironmentJson(raw: unknown): EnvironmentJson {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const input = raw as Record<string, unknown>;
  const config: EnvironmentJson = {};
  if (typeof input.snapshot === "string") config.snapshot = input.snapshot;
  if (typeof input.install === "string") config.install = input.install;
  if (typeof input.start === "string") config.start = input.start;
  if (input.startMustSucceed === true) config.startMustSucceed = true;
  if (Array.isArray(input.repos) && input.repos.every((item) => typeof item === "string")) {
    config.repos = input.repos;
  }
  if (Array.isArray(input.terminals)) {
    const terminals: TerminalSpec[] = [];
    for (const item of input.terminals) {
      if (!item || typeof item !== "object") continue;
      const terminal = item as Record<string, unknown>;
      if (typeof terminal.name === "string" && typeof terminal.command === "string") {
        terminals.push({ name: terminal.name, command: terminal.command });
      }
    }
    if (terminals.length > 0) {
      config.terminals = terminals;
    }
  }
  if (Array.isArray(input.mcp)) {
    const mcp: McpServerSpec[] = [];
    for (const item of input.mcp) {
      if (!item || typeof item !== "object") continue;
      const server = item as Record<string, unknown>;
      if (typeof server.name !== "string" || !server.name.trim()) continue;
      const transport = server.transport === "http" || server.transport === "stdio" ? server.transport : undefined;
      if (!transport) continue;
      const spec: McpServerSpec = { name: server.name.trim(), transport };
      if (typeof server.command === "string") spec.command = server.command;
      if (typeof server.url === "string") spec.url = server.url;
      if (Array.isArray(server.args) && server.args.every((value) => typeof value === "string")) {
        spec.args = server.args;
      }
      if (server.env && typeof server.env === "object" && !Array.isArray(server.env)) {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(server.env as Record<string, unknown>)) {
          if (typeof value === "string") env[key] = value;
        }
        if (Object.keys(env).length > 0) spec.env = env;
      }
      if (server.headers && typeof server.headers === "object" && !Array.isArray(server.headers)) {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(server.headers as Record<string, unknown>)) {
          if (typeof value === "string") headers[key] = value;
        }
        if (Object.keys(headers).length > 0) spec.headers = headers;
      }
      mcp.push(spec);
    }
    if (mcp.length > 0) config.mcp = mcp;
  }
  if (input.egress && typeof input.egress === "object" && !Array.isArray(input.egress)) {
    const egress = input.egress as Record<string, unknown>;
    if (
      egress.mode === "allow_all" ||
      egress.mode === "default_plus_allowlist" ||
      egress.mode === "allowlist_only"
    ) {
      config.egress = {
        mode: egress.mode,
        domains: Array.isArray(egress.domains)
          ? egress.domains.filter((item): item is string => typeof item === "string")
          : undefined,
      };
    }
  }
  return config;
}

export type SecretKind = "environment_variable" | "runtime" | "build";

export interface SecretRef {
  name: string;
  kind: SecretKind;
}

export interface Environment {
  id: string;
  orgId: string;
  name: string;
  /** Present when config is read from a repo file. */
  environmentJsonPath: string | null;
  config: EnvironmentJson;
  secrets: SecretRef[];
  createdAt: string;
  updatedAt: string;
}

export type BuildStatus =
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED";

export type BuildSource = "manual" | "scheduled" | "env_save" | "agent";

export interface Build {
  id: string;
  envId: string;
  envVersionId: string;
  orgId: string;
  status: BuildStatus;
  source: BuildSource;
  /** Draft builds never become the boot image for new runs. */
  draft: boolean;
  snapshotId: string | null;
  snapshotPath: string | null;
  fingerprint: string;
  repoUrls: string[];
  ref: string | null;
  createdAt: string;
  completedAt: string | null;
  failureMessage: string | null;
}

export interface CreateEnvironmentRequest {
  name?: string;
  repoUrls?: string[];
  config?: EnvironmentJson;
}

export interface CreateBuildRequest {
  envId?: string;
  name?: string;
  repoUrls: string[];
  ref?: string;
  draft?: boolean;
  source?: BuildSource;
  environmentJson?: EnvironmentJson;
}
