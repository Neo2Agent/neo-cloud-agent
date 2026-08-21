import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./env.js";

loadRootEnv();

function repoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

export function getConfig() {
  return {
    port: Number(process.env.CONTROL_PLANE_PORT ?? 8080),
    orgId: process.env.DEFAULT_ORG_ID ?? "org_local",
    userId: process.env.DEFAULT_USER_ID ?? "user_local",
    workerImage: process.env.WORKER_IMAGE ?? "neo-cloud-agent/worker:dev",
    defaultModel: process.env.DEFAULT_MODEL ?? "neo/deepseek",
    llmUpstream: process.env.LLM_UPSTREAM ?? null,
    jwtSecret: process.env.LLM_GATEWAY_JWT_SECRET ?? "dev-only-change-me",
    llmGatewayUrl: (process.env.LLM_GATEWAY_URL ?? "http://127.0.0.1:8081").replace(/\/$/, ""),
    controlPlaneUrl: (process.env.CONTROL_PLANE_URL ?? `http://127.0.0.1:${process.env.CONTROL_PLANE_PORT ?? 8080}`).replace(
      /\/$/,
      "",
    ),
    spawnLocalWorker: process.env.SPAWN_LOCAL_WORKER !== "0",
    runsDir: process.env.RUNS_DIR ?? path.join(repoRoot(), ".neo/runs"),
  };
}
