import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Run } from "@neo-cloud-agent/contracts";
import { getConfig, workerRuntimeKind } from "../config.js";
import { measureWorkspaceBytes } from "../scm/workspace.js";
import { controlStateDir } from "../store/persist.js";
import { hostWorkspaceFor } from "../worker-spawn.js";

export type WorkspaceState = "present" | "evicted" | "missing";
export type WorkspaceEvictReason = "budget" | "ttl";

export type WorkspaceMeta = {
  version: 1;
  state: WorkspaceState;
  bytes: number;
  persistedAt: string | null;
  evictedAt?: string;
  evictedReason?: WorkspaceEvictReason;
};

export type WorkspaceStoreSummary = {
  bytes: number;
  maxBytes: number | null;
  persistMaxBytes: number | null;
  runCount: number;
  present: number;
  evicted: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RESERVED_HOST_NAMES = new Set([".control", ".objects", ".builds", ".warm", ".firecracker", ".vms"]);
const LIVE = new Set<Run["status"]>([
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);
const TIER: Partial<Record<Run["status"], number>> = {
  EXPIRED: 0,
  ARCHIVED: 1,
  ERROR: 2,
  IDLE: 3,
};

function asFinite(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function workspaceReclaimEnabled(): boolean {
  const raw = process.env.WORKSPACE_RECLAIM;
  return raw !== "0" && raw !== "false";
}

export function workspaceStoreMaxBytes(): number {
  const fallback = workerRuntimeKind() === "vm" ? 12288 : 0;
  return asFinite(process.env.WORKSPACE_STORE_MAX_MIB, fallback) * 1024 * 1024;
}

export function workspacePersistMaxBytes(): number {
  return asFinite(process.env.WORKSPACE_PERSIST_MAX_MIB, 1024) * 1024 * 1024;
}

export function workspaceIdleTtlMs(): number {
  return asFinite(process.env.WORKSPACE_IDLE_TTL_MS, 7 * DAY_MS);
}

export function workspaceArchivedTtlMs(): number {
  return asFinite(process.env.WORKSPACE_ARCHIVED_TTL_MS, 3 * DAY_MS);
}

export function workspaceReclaimIntervalMs(): number {
  return asFinite(process.env.WORKSPACE_RECLAIM_INTERVAL_MS, 60_000);
}

export function workspaceMetaPath(runId: string, runsDir?: string): string {
  return path.join(controlStateDir(runsDir), `${runId}.workspace.json`);
}

export function loadWorkspaceMeta(runId: string, runsDir?: string): WorkspaceMeta | null {
  try {
    const parsed = JSON.parse(readFileSync(workspaceMetaPath(runId, runsDir), "utf8")) as WorkspaceMeta;
    if (!parsed || parsed.version !== 1) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspaceMeta(runId: string, meta: WorkspaceMeta, runsDir?: string): void {
  const file = workspaceMetaPath(runId, runsDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`);
  renameSync(tmp, file);
}

export function markWorkspacePresent(runId: string, bytes: number, at = new Date().toISOString()): WorkspaceMeta {
  const meta: WorkspaceMeta = { version: 1, state: "present", bytes, persistedAt: at };
  saveWorkspaceMeta(runId, meta);
  return meta;
}

export function evictHostWorkspace(
  runId: string,
  reason: WorkspaceEvictReason,
  at = new Date().toISOString(),
): WorkspaceMeta {
  const dest = hostWorkspaceFor(runId);
  if (existsSync(dest)) {
    for (const entry of readdirSync(dest)) {
      rmSync(path.join(dest, entry), { recursive: true, force: true });
    }
  }
  const meta: WorkspaceMeta = {
    version: 1,
    state: "evicted",
    bytes: 0,
    persistedAt: loadWorkspaceMeta(runId)?.persistedAt ?? null,
    evictedAt: at,
    evictedReason: reason,
  };
  saveWorkspaceMeta(runId, meta);
  return meta;
}

export function listHostWorkspaceRunIds(hostDir = getConfig().hostRunsDir): string[] {
  if (!existsSync(hostDir)) {
    return [];
  }
  return readdirSync(hostDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !RESERVED_HOST_NAMES.has(entry.name) && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

export function summarizeWorkspaceStore(): WorkspaceStoreSummary {
  const max = workspaceStoreMaxBytes();
  const persistMax = workspacePersistMaxBytes();
  let bytes = 0;
  let present = 0;
  let evicted = 0;
  const ids = listHostWorkspaceRunIds();
  for (const runId of ids) {
    const meta = loadWorkspaceMeta(runId);
    if (meta?.state === "evicted") {
      evicted += 1;
      continue;
    }
    bytes += meta?.state === "present" && typeof meta.bytes === "number" ? meta.bytes : measureWorkspaceBytes(hostWorkspaceFor(runId));
    present += 1;
  }
  return {
    bytes,
    maxBytes: max > 0 ? max : null,
    persistMaxBytes: persistMax > 0 ? persistMax : null,
    runCount: ids.length,
    present,
    evicted,
  };
}

type ReclaimCandidate = {
  runId: string;
  bytes: number;
  updatedAt: number;
  tier: number;
  overSoftCap: boolean;
  ttlExpired: boolean;
};

function sortForEvict(left: ReclaimCandidate, right: ReclaimCandidate): number {
  if (left.tier !== right.tier) {
    return left.tier - right.tier;
  }
  if (left.overSoftCap !== right.overSoftCap) {
    return left.overSoftCap ? -1 : 1;
  }
  return left.updatedAt - right.updatedAt;
}

export function reclaimPersistedWorkspaces(input: {
  runs: Iterable<Run>;
  protectedIds: Set<string>;
  exceptRunId?: string;
  now?: number;
}): { evicted: Array<{ runId: string; reason: WorkspaceEvictReason; bytes: number }> } {
  if (!workspaceReclaimEnabled()) {
    return { evicted: [] };
  }
  const now = input.now ?? Date.now();
  const byId = new Map<string, Run>();
  for (const run of input.runs) {
    byId.set(run.id, run);
  }
  const persistMax = workspacePersistMaxBytes();
  const storeMax = workspaceStoreMaxBytes();
  const idleTtl = workspaceIdleTtlMs();
  const archivedTtl = workspaceArchivedTtlMs();
  const evicted: Array<{ runId: string; reason: WorkspaceEvictReason; bytes: number }> = [];
  const candidates: ReclaimCandidate[] = [];

  for (const runId of listHostWorkspaceRunIds()) {
    if (runId === input.exceptRunId || input.protectedIds.has(runId)) {
      continue;
    }
    const run = byId.get(runId);
    if (run && LIVE.has(run.status)) {
      continue;
    }
    const dest = hostWorkspaceFor(runId);
    const meta = loadWorkspaceMeta(runId);
    if (meta?.state === "evicted") {
      continue;
    }
    const bytes = measureWorkspaceBytes(dest);
    if (bytes <= 0) {
      continue;
    }
    const updatedAt = Date.parse(run?.updatedAt ?? meta?.persistedAt ?? "") || 0;
    const status = run?.status ?? "EXPIRED";
    const ttl = status === "ARCHIVED" || status === "EXPIRED" ? archivedTtl : idleTtl;
    candidates.push({
      runId,
      bytes,
      updatedAt,
      tier: TIER[status] ?? 0,
      overSoftCap: persistMax > 0 && bytes > persistMax,
      ttlExpired: ttl > 0 && updatedAt > 0 && now - updatedAt >= ttl,
    });
  }

  for (const item of [...candidates].sort(sortForEvict)) {
    if (!item.ttlExpired) {
      continue;
    }
    evictHostWorkspace(item.runId, "ttl", new Date(now).toISOString());
    evicted.push({ runId: item.runId, reason: "ttl", bytes: item.bytes });
    item.bytes = 0;
  }

  if (storeMax > 0) {
    let used = 0;
    for (const runId of listHostWorkspaceRunIds()) {
      if (loadWorkspaceMeta(runId)?.state === "evicted") {
        continue;
      }
      used += measureWorkspaceBytes(hostWorkspaceFor(runId));
    }
    const remaining = candidates.filter((item) => item.bytes > 0).sort(sortForEvict);
    for (const item of remaining) {
      if (used <= storeMax) {
        break;
      }
      evictHostWorkspace(item.runId, "budget", new Date(now).toISOString());
      evicted.push({ runId: item.runId, reason: "budget", bytes: item.bytes });
      used -= item.bytes;
    }
  }

  return { evicted };
}
