import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { vmWorkspaceFor } from "./runtime/vm-slots.js";

export function repoRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

export function workspaceFor(runId: string): string {
  return vmWorkspaceFor(runId) ?? path.join(getConfig().runsDir, runId);
}

export function hostWorkspaceFor(runId: string): string {
  return path.join(getConfig().hostRunsDir, runId);
}
