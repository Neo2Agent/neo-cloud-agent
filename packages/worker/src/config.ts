export function getWorkerConfig() {
  return {
    runId: process.env.RUN_ID ?? "",
    controlPlaneUrl: (process.env.CONTROL_PLANE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, ""),
    llmGatewayUrl: (process.env.LLM_GATEWAY_URL ?? "http://127.0.0.1:8081").replace(/\/$/, ""),
    llmGatewayJwt: process.env.LLM_GATEWAY_JWT ?? "",
    workspaceDir: process.env.WORKSPACE_DIR ?? "/workspace",
    sessionDir: process.env.SESSION_DIR ?? "/var/neo/sessions",
    workerVersion: process.env.WORKER_VERSION ?? "0.1.0",
    model: process.env.NEO_MODEL ?? "neo/sonnet",
    pollMs: Number(process.env.WORKER_POLL_MS ?? 400),
  };
}
