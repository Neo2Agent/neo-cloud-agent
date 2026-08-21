export interface WorkerEnvInput {
  runId: string;
  jwt: string;
  controlPlaneUrl: string;
  llmGatewayUrl: string;
  workspaceDir: string;
  sessionDir: string;
  model: string;
  egressMode?: string;
  egressDomains?: string[];
}

const SECRET_KEYS = [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLM_UPSTREAM_API_KEY",
  "LLM_GATEWAY_JWT_SECRET",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "SCM_PUSH_TOKEN",
];

/** Env injected into a worker. Provider keys must never appear here. */
export function buildWorkerEnv(input: WorkerEnvInput): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    LANG: process.env.LANG ?? "C.UTF-8",
    RUN_ID: input.runId,
    LLM_GATEWAY_JWT: input.jwt,
    LLM_GATEWAY_URL: input.llmGatewayUrl,
    CONTROL_PLANE_URL: input.controlPlaneUrl,
    WORKSPACE_DIR: input.workspaceDir,
    SESSION_DIR: input.sessionDir,
    NEO_MODEL: input.model,
    NEO_EGRESS_MODE: input.egressMode ?? "allow_all",
    NEO_EGRESS_DOMAINS: (input.egressDomains ?? []).join(","),
  };
}

export function assertNoProviderSecrets(env: Record<string, string>): void {
  for (const key of SECRET_KEYS) {
    if (key in env) {
      throw new Error(`worker env must not include ${key}`);
    }
  }
}

export function containerName(runId: string): string {
  return `neo-run-${runId}`;
}
