import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./env.js";

loadRootEnv();

function repoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

export type WorkerRuntimeKind = "local" | "docker" | "none";

export function workerRuntimeKind(): WorkerRuntimeKind {
  const explicit = process.env.WORKER_RUNTIME;
  if (explicit === "local" || explicit === "docker" || explicit === "none") {
    return explicit;
  }
  return process.env.SPAWN_LOCAL_WORKER === "0" ? "docker" : "local";
}

export function getConfig() {
  const kind = workerRuntimeKind();
  const port = Number(process.env.CONTROL_PLANE_PORT ?? 8080);
  const gatewayPort = Number(process.env.LLM_GATEWAY_PORT ?? 8081);
  const controlPlaneUrl = (
    process.env.CONTROL_PLANE_URL ?? `http://127.0.0.1:${port}`
  ).replace(/\/$/, "");
  const llmGatewayUrl = (process.env.LLM_GATEWAY_URL ?? `http://127.0.0.1:${gatewayPort}`).replace(/\/$/, "");
  const runsDir = process.env.RUNS_DIR ?? path.join(repoRoot(), ".neo/runs");
  return {
    port,
    orgId: process.env.DEFAULT_ORG_ID ?? "org_local",
    userId: process.env.DEFAULT_USER_ID ?? "user_local",
    workerImage: process.env.WORKER_IMAGE ?? "neo-cloud-agent-worker:dev",
    defaultModel: process.env.DEFAULT_MODEL ?? "neo/deepseek",
    llmUpstream: process.env.LLM_UPSTREAM ?? null,
    jwtSecret: process.env.LLM_GATEWAY_JWT_SECRET ?? "dev-only-change-me",
    llmGatewayUrl,
    controlPlaneUrl,
    workerRuntime: kind,
    spawnLocalWorker: kind === "local",
    runsDir,
    hostRunsDir: process.env.HOST_RUNS_DIR ?? runsDir,
    workerWorkspaceMount: process.env.WORKER_WORKSPACE_MOUNT ?? "/workspace",
    workerControlPlaneUrl: (
      process.env.WORKER_CONTROL_PLANE_URL ??
      (kind === "docker" ? `http://host.docker.internal:${port}` : controlPlaneUrl)
    ).replace(/\/$/, ""),
    workerLlmGatewayUrl: (
      process.env.WORKER_LLM_GATEWAY_URL ??
      (kind === "docker" ? `http://host.docker.internal:${gatewayPort}` : llmGatewayUrl)
    ).replace(/\/$/, ""),
    dockerNetwork: process.env.DOCKER_NETWORK || null,
  };
}
