import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECRET_ENV_KEYS } from "@neo-cloud-agent/contracts";

export function deskRepoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

export function spawnDeskWorker(input: {
  runId: string;
  jwt: string;
  controlPlaneUrl: string;
  llmGatewayUrl: string;
  workspaceDir: string;
  sessionDir?: string;
  model: string;
  nodePath?: string;
}): ChildProcess {
  const root = deskRepoRoot();
  const tsxCli = path.join(root, "node_modules/tsx/dist/cli.mjs");
  const workerEntry = path.join(root, "packages/worker/src/index.ts");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RUN_ID: input.runId,
    LLM_GATEWAY_JWT: input.jwt,
    CONTROL_PLANE_URL: input.controlPlaneUrl,
    LLM_GATEWAY_URL: input.llmGatewayUrl,
    WORKSPACE_DIR: input.workspaceDir,
    SESSION_DIR: input.sessionDir ?? path.join(input.workspaceDir, "sessions"),
    NEO_MODEL: input.model,
    WORKER_POLL_MS: process.env.WORKER_POLL_MS ?? "200",
    ELECTRON_RUN_AS_NODE: "1",
  };
  for (const key of SECRET_ENV_KEYS) {
    delete env[key];
  }
  delete env.DEEPSEEK_API_KEY;
  delete env.OPENAI_API_KEY;
  const nodePath = input.nodePath ?? process.execPath;
  return spawn(nodePath, [tsxCli, workerEntry], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
