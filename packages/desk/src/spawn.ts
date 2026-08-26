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
  /** Per-run state, kept outside the user's repo. */
  stateDir: string;
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
    SESSION_DIR: path.join(input.stateDir, "sessions"),
    NEO_RUN_BOOTSTRAP: path.join(input.stateDir, "run-bootstrap.json"),
    // The workspace is one folder inside the user's real filesystem, so the
    // worker has to refuse anything outside it.
    NEO_SANDBOX_ROOT: input.workspaceDir,
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
