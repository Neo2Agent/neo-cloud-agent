import path from "node:path";
import { persistWorkspaceTree } from "../scm/workspace.js";
import { hostWorkspaceFor } from "../worker-spawn.js";
import { vmWorkspaceFor } from "./vm-slots.js";

export async function persistRunWorkspace(runId: string): Promise<boolean> {
  const src = vmWorkspaceFor(runId);
  if (!src) {
    return false;
  }
  const dest = hostWorkspaceFor(runId);
  if (path.resolve(src) === path.resolve(dest)) {
    return false;
  }
  await persistWorkspaceTree(src, dest);
  return true;
}
