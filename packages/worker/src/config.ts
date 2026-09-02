import { readFileSync } from "node:fs";
import path from "node:path";
import type { EgressPolicy } from "@neo-cloud-agent/contracts";

type RunBootstrapFile = Partial<{
  runId: string;
  controlPlaneUrl: string;
  llmGatewayUrl: string;
  jwt: string;
  model: string;
  egress: EgressPolicy;
}>;

/**
 * Cloud runs keep the bootstrap inside the workspace. Desk runs keep it in the
 * app's own data dir instead, so a run never drops credentials into the user's
 * repo; `NEO_RUN_BOOTSTRAP` points at it in that case.
 */
function readBootstrapFile(workspaceDir: string): RunBootstrapFile {
  const file = process.env.NEO_RUN_BOOTSTRAP || path.join(workspaceDir, ".neo", "run-bootstrap.json");
  try {
    return JSON.parse(readFileSync(file, "utf8")) as RunBootstrapFile;
  } catch {
    return {};
  }
}

export function getWorkerConfig() {
  const workspaceDir = process.env.WORKSPACE_DIR ?? "/workspace";
  const file = readBootstrapFile(workspaceDir);
  const sandboxRoot = process.env.NEO_SANDBOX_ROOT?.trim();
  const scratchDir = process.env.NEO_RUN_SCRATCH_DIR?.trim();
  /** Desk This Computer only. Cloud VMs leave this unset so host homes stay unread. */
  const hostSkillDirs = (process.env.NEO_HOST_SKILL_DIRS ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  return {
    /**
     * Per-run scratch inside the workspace, set only when several runs can share
     * one folder. Empty means the folder belongs to this run alone and the plain
     * `<workspace>/.neo` layout is correct, which is how every cloud run works.
     */
    scratchDir: scratchDir ? path.resolve(scratchDir) : "",
    /**
     * Desk-only. System skills live in `~/.neo/skills-neo` (like Cursor's
     * `~/.cursor/skills-cursor`) and are outside the user's project folder.
     */
    hostSkillDirs,
    runId: process.env.RUN_ID || file.runId || "",
    controlPlaneUrl: (process.env.CONTROL_PLANE_URL || file.controlPlaneUrl || "http://127.0.0.1:8080").replace(/\/$/, ""),
    llmGatewayUrl: (process.env.LLM_GATEWAY_URL || file.llmGatewayUrl || "http://127.0.0.1:8081").replace(/\/$/, ""),
    llmGatewayJwt: process.env.LLM_GATEWAY_JWT || file.jwt || "",
    workspaceDir,
    sessionDir: process.env.SESSION_DIR ?? "/var/neo/sessions",
    workerVersion: process.env.WORKER_VERSION ?? "0.1.0",
    model: process.env.NEO_MODEL || file.model || "neo/sonnet",
    pollMs: Number(process.env.WORKER_POLL_MS ?? 400),
    egress: file.egress,
    /** Set only for desk runs: the folder the agent must stay inside. */
    sandboxRoot: sandboxRoot ? path.resolve(sandboxRoot) : "",
    /**
     * Desk runs live on someone's laptop, so the worker exits once the turn is
     * done instead of idling with a token that will expire under it. The next
     * turn gets a fresh process and restores the session backup.
     */
    exitAfterTurn: process.env.WORKER_EXIT_AFTER_TURN === "1",
  };
}
