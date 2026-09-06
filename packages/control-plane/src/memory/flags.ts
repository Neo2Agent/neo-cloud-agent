import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MemoryItem, MemoryKind, MemoryStatus } from "@neo-cloud-agent/contracts";
import { parseMemoryKind, parseMemoryStatus } from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";

export type MemoryFlags = {
  pinned?: boolean;
  kind?: MemoryKind;
  status?: MemoryStatus;
};

type Snapshot = Record<string, Record<string, MemoryFlags>>;

function flagsFile(): string {
  return path.join(controlStateDir(), "memory-flags.json");
}

function readSnapshot(): Snapshot {
  try {
    const parsed = JSON.parse(readFileSync(flagsFile(), "utf8")) as Snapshot;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSnapshot(snapshot: Snapshot): void {
  const file = flagsFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot)}\n`);
  renameSync(tmp, file);
}

export function mergeMemoryFlags(userId: string, id: string, patch: MemoryFlags): MemoryFlags {
  const snapshot = readSnapshot();
  const current = snapshot[userId]?.[id] ?? {};
  const next: MemoryFlags = { ...current };
  if (patch.pinned !== undefined) {
    next.pinned = patch.pinned;
  }
  if (patch.kind !== undefined) {
    next.kind = patch.kind;
  }
  if (patch.status !== undefined) {
    next.status = patch.status;
  }
  snapshot[userId] = { ...snapshot[userId], [id]: next };
  writeSnapshot(snapshot);
  return next;
}

export function deleteMemoryFlags(userId: string, id: string): void {
  const snapshot = readSnapshot();
  if (!snapshot[userId]?.[id]) {
    return;
  }
  const nextUser = { ...snapshot[userId] };
  delete nextUser[id];
  if (Object.keys(nextUser).length === 0) {
    delete snapshot[userId];
  } else {
    snapshot[userId] = nextUser;
  }
  writeSnapshot(snapshot);
}

export function applyMemoryFlags(userId: string, items: MemoryItem[]): MemoryItem[] {
  const flags = readSnapshot()[userId] ?? {};
  return items.map((item) => {
    const overlay = flags[item.id];
    const kind = overlay?.kind ?? parseMemoryKind(item.metadata?.kind);
    const status = overlay?.status ?? parseMemoryStatus(item.metadata?.status);
    const pinned = overlay?.pinned ?? item.metadata?.pinned;
    if (!kind && !status && pinned === undefined && !item.metadata) {
      return item;
    }
    return {
      ...item,
      metadata: {
        ...item.metadata,
        ...(kind ? { kind } : {}),
        ...(status ? { status } : {}),
        ...(pinned !== undefined ? { pinned } : {}),
      },
    };
  });
}
