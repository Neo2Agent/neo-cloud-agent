import { existsSync } from "node:fs";
import path from "node:path";
import { measureWorkspaceBytes, persistDurableWorkspace } from "../scm/workspace.js";
import { hostWorkspaceFor } from "../worker-spawn.js";
import { markWorkspacePresent } from "./workspace-store.js";
import { vmWorkspaceFor } from "./vm-slots.js";

export type PersistWorkspaceResult =
  | { ok: true; persisted: boolean; reason?: "no-slot" | "same-path"; bytes: number }
  | { ok: false; error: string };

async function persistRunWorkspaceImpl(runId: string): Promise<PersistWorkspaceResult> {
  const dest = hostWorkspaceFor(runId);
  const src = vmWorkspaceFor(runId);
  try {
    if (!src) {
      const bytes = measureWorkspaceBytes(dest);
      if (existsSync(dest)) {
        markWorkspacePresent(runId, bytes);
      }
      return { ok: true, persisted: false, reason: "no-slot", bytes };
    }
    if (path.resolve(src) === path.resolve(dest)) {
      const bytes = measureWorkspaceBytes(dest);
      markWorkspacePresent(runId, bytes);
      return { ok: true, persisted: false, reason: "same-path", bytes };
    }
    await persistDurableWorkspace(src, dest);
    const bytes = measureWorkspaceBytes(dest);
    markWorkspacePresent(runId, bytes);
    return { ok: true, persisted: true, bytes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

let persistImpl = persistRunWorkspaceImpl;

export function setPersistRunWorkspaceForTests(next?: typeof persistRunWorkspaceImpl): void {
  persistImpl = next ?? persistRunWorkspaceImpl;
}

export async function persistRunWorkspace(runId: string): Promise<PersistWorkspaceResult> {
  return persistImpl(runId);
}
