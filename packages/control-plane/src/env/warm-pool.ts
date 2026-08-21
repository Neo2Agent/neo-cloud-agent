import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DiskCloneMethod } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { materializeSnapshot } from "../scm/clone.js";
import { controlStateDir } from "../store/persist.js";

export type WarmSlot = {
  id: string;
  buildId: string;
  path: string;
  ready: boolean;
  claimedBy: string | null;
  cloneMethod?: DiskCloneMethod;
};

type WarmIndex = {
  slots: WarmSlot[];
};

function indexFile(runsDir = getConfig().runsDir): string {
  return path.join(controlStateDir(runsDir), "warm-pool.json");
}

function warmRoot(buildId: string, runsDir = getConfig().runsDir): string {
  return path.join(runsDir, ".warm", buildId);
}

function readIndex(runsDir?: string): WarmIndex {
  try {
    const parsed = JSON.parse(readFileSync(indexFile(runsDir), "utf8")) as WarmIndex;
    return { slots: Array.isArray(parsed.slots) ? parsed.slots : [] };
  } catch {
    return { slots: [] };
  }
}

function writeIndex(index: WarmIndex, runsDir?: string): void {
  const file = indexFile(runsDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`);
  renameSync(tmp, file);
}

export function warmPoolSize(): number {
  const raw = Number(process.env.WARM_POOL_SIZE ?? 1);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

export function listWarmSlots(buildId?: string, runsDir?: string): WarmSlot[] {
  const slots = readIndex(runsDir).slots;
  return buildId ? slots.filter((item) => item.buildId === buildId) : slots;
}

export function readyWarmCount(buildId?: string, runsDir?: string): number {
  return listWarmSlots(buildId, runsDir).filter((item) => item.ready && existsSync(item.path)).length;
}

export async function claimWarmSlot(buildId: string, dest: string, runsDir?: string): Promise<boolean> {
  const index = readIndex(runsDir);
  const slot = index.slots.find((item) => item.buildId === buildId && item.ready && existsSync(item.path));
  if (!slot) {
    return false;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  renameSync(slot.path, dest);
  slot.ready = false;
  slot.claimedBy = dest;
  writeIndex(index, runsDir);
  return true;
}

export async function refillWarmPool(buildId: string, snapshotPath: string, runsDir = getConfig().runsDir): Promise<WarmSlot[]> {
  const size = warmPoolSize();
  if (size <= 0 || !existsSync(snapshotPath)) {
    return listWarmSlots(buildId, runsDir);
  }
  const index = readIndex(runsDir);
  const ready = index.slots.filter((item) => item.buildId === buildId && item.ready && existsSync(item.path));
  const created: WarmSlot[] = [];
  while (ready.length + created.length < size) {
    const id = crypto.randomUUID();
    const dest = path.join(warmRoot(buildId, runsDir), id);
    rmSync(dest, { recursive: true, force: true });
    const cloned = await materializeSnapshot(snapshotPath, dest);
    const slot: WarmSlot = { id, buildId, path: dest, ready: true, claimedBy: null, cloneMethod: cloned.method };
    index.slots.push(slot);
    created.push(slot);
  }
  if (created.length > 0) {
    writeIndex(index, runsDir);
  }
  return listWarmSlots(buildId, runsDir);
}

export function resetWarmPoolForTests(runsDir = getConfig().runsDir): void {
  writeIndex({ slots: [] }, runsDir);
  rmSync(path.join(runsDir, ".warm"), { recursive: true, force: true });
}
