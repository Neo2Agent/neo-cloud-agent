import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CreateDeskRequest, Desk } from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";
import { deskPersistHooks } from "./persist-hooks.js";

const ONLINE_MS = 45_000;
const MAX_DESKS = 20;

export type StoredDesk = Desk & { tokenHash: string };

type Waiter = {
  resolve: (runId: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

const assignments = new Map<string, string[]>();
const waiters = new Map<string, Waiter[]>();

export function desksFile(): string {
  return path.join(controlStateDir(), "desks.json");
}

function now(): string {
  return new Date().toISOString();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicDesk(item: StoredDesk, at = Date.now()): Desk {
  const lastSeen = Date.parse(item.lastSeenAt);
  return {
    id: item.id,
    userId: item.userId,
    orgId: item.orgId,
    name: item.name,
    hostname: item.hostname,
    platform: item.platform,
    createdAt: item.createdAt,
    lastSeenAt: item.lastSeenAt,
    online: Number.isFinite(lastSeen) && at - lastSeen < ONLINE_MS,
  };
}

function normalize(value: unknown): StoredDesk | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record || typeof record.id !== "string" || typeof record.userId !== "string") {
    return null;
  }
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : now();
  return {
    id: record.id,
    userId: record.userId,
    orgId: typeof record.orgId === "string" ? record.orgId : "org_local",
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : "This Computer",
    hostname: typeof record.hostname === "string" ? record.hostname : "",
    platform: typeof record.platform === "string" ? record.platform : "unknown",
    createdAt,
    lastSeenAt: typeof record.lastSeenAt === "string" ? record.lastSeenAt : createdAt,
    online: false,
    tokenHash: typeof record.tokenHash === "string" ? record.tokenHash : "",
  };
}

function readAll(): StoredDesk[] {
  try {
    const parsed = JSON.parse(readFileSync(desksFile(), "utf8")) as { desks?: unknown };
    return Array.isArray(parsed.desks) ? parsed.desks.map(normalize).filter((item): item is StoredDesk => Boolean(item)) : [];
  } catch {
    return [];
  }
}

function writeAll(items: StoredDesk[], options?: { mirror?: boolean }): void {
  mkdirSync(path.dirname(desksFile()), { recursive: true });
  writeFileSync(desksFile(), `${JSON.stringify({ version: 1, desks: items }, null, 2)}\n`, { mode: 0o600 });
  if (options?.mirror !== false) {
    deskPersistHooks().onWrite?.(items.map((item) => publicDesk(item)));
  }
}

export function replaceDesks(items: Desk[], options?: { mirror?: boolean }): void {
  const current = new Map(readAll().map((item) => [item.id, item]));
  writeAll(
    items
      .map((item) => {
        const prev = current.get(item.id);
        return normalize({ ...prev, ...item, tokenHash: prev?.tokenHash ?? "" });
      })
      .filter((item): item is StoredDesk => Boolean(item)),
    options,
  );
}

export function listDesks(userId?: string, at = Date.now()): Desk[] {
  return readAll()
    .filter((item) => !userId || item.userId === userId)
    .map((item) => publicDesk(item, at));
}

export function getDesk(id: string, at = Date.now()): Desk | undefined {
  const found = readAll().find((item) => item.id === id);
  return found ? publicDesk(found, at) : undefined;
}

export function getStoredDesk(id: string): StoredDesk | undefined {
  return readAll().find((item) => item.id === id);
}

export function isDeskOnline(desk: Pick<Desk, "lastSeenAt">, at = Date.now()): boolean {
  const lastSeen = Date.parse(desk.lastSeenAt);
  return Number.isFinite(lastSeen) && at - lastSeen < ONLINE_MS;
}

export function createDesk(
  input: CreateDeskRequest,
  owner: { userId: string; orgId: string },
): { desk: Desk; token: string } {
  const items = readAll();
  if (items.filter((item) => item.userId === owner.userId).length >= MAX_DESKS) {
    throw new Error(`at most ${MAX_DESKS} desks`);
  }
  const createdAt = now();
  const token = `desk_${randomBytes(24).toString("base64url")}`;
  const stored: StoredDesk = {
    id: `desk_${randomBytes(8).toString("hex")}`,
    userId: owner.userId,
    orgId: owner.orgId,
    name: input.name?.trim() || input.hostname?.trim() || "This Computer",
    hostname: input.hostname?.trim() || "",
    platform: input.platform?.trim() || "unknown",
    createdAt,
    lastSeenAt: createdAt,
    online: true,
    tokenHash: hashToken(token),
  };
  items.push(stored);
  writeAll(items);
  return { desk: publicDesk(stored), token };
}

export function findDeskByToken(token: string, at = Date.now()): Desk | undefined {
  const hash = hashToken(token);
  const found = readAll().find((item) => item.tokenHash && item.tokenHash === hash);
  return found ? publicDesk(found, at) : undefined;
}

export function touchDesk(id: string, at = Date.now()): Desk | undefined {
  const items = readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    return undefined;
  }
  const current = items[index];
  if (!current) {
    return undefined;
  }
  current.lastSeenAt = new Date(at).toISOString();
  items[index] = current;
  writeAll(items);
  return publicDesk(current, at);
}

export function deleteDesk(id: string, userId?: string): boolean {
  const items = readAll();
  const next = items.filter((item) => item.id !== id || (userId && item.userId !== userId));
  if (next.length === items.length) {
    return false;
  }
  writeAll(next);
  assignments.delete(id);
  return true;
}

export function offerDeskAssignment(deskId: string, runId: string): void {
  const queue = assignments.get(deskId) ?? [];
  if (!queue.includes(runId)) {
    queue.push(runId);
    assignments.set(deskId, queue);
  }
  const pending = waiters.get(deskId) ?? [];
  const waiter = pending.shift();
  if (waiter) {
    clearTimeout(waiter.timer);
    waiters.set(deskId, pending);
    waiter.resolve(runId);
  }
}

export function takeDeskAssignment(deskId: string): string | null {
  const queue = assignments.get(deskId) ?? [];
  const runId = queue.shift() ?? null;
  assignments.set(deskId, queue);
  return runId;
}

export function waitDeskAssignment(deskId: string, waitMs: number): Promise<string | null> {
  const ready = takeDeskAssignment(deskId);
  if (ready) {
    return Promise.resolve(ready);
  }
  const timeout = Math.max(0, Math.min(waitMs, 25_000));
  return new Promise((resolve) => {
    const waiter: Waiter = {
      resolve,
      timer: setTimeout(() => {
        const list = waiters.get(deskId) ?? [];
        waiters.set(
          deskId,
          list.filter((item) => item !== waiter),
        );
        resolve(null);
      }, timeout),
    };
    waiter.timer.unref?.();
    const list = waiters.get(deskId) ?? [];
    list.push(waiter);
    waiters.set(deskId, list);
  });
}

export function resetDeskAssignmentsForTests(): void {
  assignments.clear();
  for (const list of waiters.values()) {
    for (const waiter of list) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
  }
  waiters.clear();
}
