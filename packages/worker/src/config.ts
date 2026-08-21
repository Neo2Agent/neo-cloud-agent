import { readFileSync } from "node:fs";
import path from "node:path";

function readBootstrapFile(workspaceDir: string): Partial<{
  runId: string;
  controlPlaneUrl: string;
  llmGatewayUrl: string;
  jwt: string;
  model: string;
}> {
  const file = path.join(workspaceDir, ".neo", "run-bootstrap.json");
  try {
    return JSON.parse(readFileSync(file, "utf8")) as {
      runId?: string;
      controlPlaneUrl?: string;
      llmGatewayUrl?: string;
      jwt?: string;
      model?: string;
    };
  } catch {
    return {};
  }
}

export function getWorkerConfig() {
  const workspaceDir = process.env.WORKSPACE_DIR ?? "/workspace";
  const file = readBootstrapFile(workspaceDir);
  return {
    runId: process.env.RUN_ID || file.runId || "",
    controlPlaneUrl: (process.env.CONTROL_PLANE_URL || file.controlPlaneUrl || "http://127.0.0.1:8080").replace(/\/$/, ""),
    llmGatewayUrl: (process.env.LLM_GATEWAY_URL || file.llmGatewayUrl || "http://127.0.0.1:8081").replace(/\/$/, ""),
    llmGatewayJwt: process.env.LLM_GATEWAY_JWT || file.jwt || "",
    workspaceDir,
    sessionDir: process.env.SESSION_DIR ?? "/var/neo/sessions",
    workerVersion: process.env.WORKER_VERSION ?? "0.1.0",
    model: process.env.NEO_MODEL || file.model || "neo/sonnet",
    pollMs: Number(process.env.WORKER_POLL_MS ?? 400),
  };
}
