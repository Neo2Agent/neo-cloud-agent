import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  BindDeskWorkspaceRequest,
  CreateDeskRequest,
  Desk,
  DeskInboxEvent,
  DeskWorkspace,
  UpdateDeskRequest,
} from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";
import { deskPersistHooks } from "./persist-hooks.js";

const MAX_DESKS = 20;
const MAX_WORKSPACES = 20;

export type StoredDesk = Desk & { tokenHash: string };

type Waiter = {
  resolve: (runId: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

type InboxSink = (event: DeskInboxEvent) => void;

const assignments = new Map<string, string[]>();
const waiters = new Map<string, Waiter[]>();
/**
 * Live desk inbox streams. A desk is only reachable while it holds one, so this
 * map is the authority for `online` instead of a polled timestamp.
 */
const inboxes = new Map<string, Set<InboxSink>>();

export function desksFile(): string {
  return path.join(controlStateDir(), "desks.json");
}

function now(): string {
  return new Date().toISOString();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicDesk(item: StoredDesk, _at = Date.now()): Desk {
  return {
    id: item.id,
    userId: item.userId,
    orgId: item.orgId,
    name: item.name,
    hostname: item.hostname,
    platform: item.platform,
    createdAt: item.createdAt,
    lastSeenAt: item.lastSeenAt,
    online: hasInbox(item.id),
    workspaces: item.workspaces ?? [],
    allowRemote: item.allowRemote === true,
  };
}

function normalizeWorkspaces(value: unknown): DeskWorkspace[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: DeskWorkspace[] = [];
  for (const entry of value) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!record || typeof record.id !== "string" || typeof record.repoKey !== "string") {
      continue;
    }
    items.push({
      id: record.id,
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : record.repoKey,
      repoKey: record.repoKey,
      git: record.git === true,
      boundAt: typeof record.boundAt === "string" ? record.boundAt : now(),
    });
  }
  return items.slice(0, MAX_WORKSPACES);
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
    workspaces: normalizeWorkspaces(record.workspaces),
    allowRemote: record.allowRemote === true,
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

/**
 * Reachable means "holding an inbox stream right now".
 *
 * A recent timestamp is not good enough: a desk that registered and quit would
 * still look alive, and remote runs would queue against a machine that is gone.
 */
export function isDeskOnline(desk: Pick<Desk, "id">): boolean {
  return Boolean(desk.id) && hasInbox(desk.id);
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
    workspaces: [],
    allowRemote: false,
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

function mutateDesk(id: string, apply: (desk: StoredDesk) => void): Desk | undefined {
  const items = readAll();
  const index = items.findIndex((item) => item.id === id);
  const current = index < 0 ? undefined : items[index];
  if (!current) {
    return undefined;
  }
  apply(current);
  items[index] = current;
  writeAll(items);
  return publicDesk(current);
}

export function updateDesk(id: string, input: UpdateDeskRequest): Desk | undefined {
  return mutateDesk(id, (desk) => {
    if (typeof input.name === "string" && input.name.trim()) {
      desk.name = input.name.trim();
    }
    if (typeof input.allowRemote === "boolean") {
      desk.allowRemote = input.allowRemote;
    }
  });
}

/** Bind one folder. Re-binding the same repo key refreshes it instead of duplicating. */
export function bindDeskWorkspace(id: string, input: BindDeskWorkspaceRequest): DeskWorkspace {
  const repoKey = input.repoKey.trim();
  const name = input.name.trim();
  if (!repoKey || !name) {
    throw new Error("workspace name and repoKey are required");
  }
  let bound: DeskWorkspace | undefined;
  const updated = mutateDesk(id, (desk) => {
    const existing = (desk.workspaces ?? []).find((item) => item.repoKey === repoKey);
    if (existing) {
      existing.name = name;
      existing.git = input.git === true;
      bound = existing;
      return;
    }
    if ((desk.workspaces ?? []).length >= MAX_WORKSPACES) {
      throw new Error(`at most ${MAX_WORKSPACES} workspaces per desk`);
    }
    bound = {
      id: `dws_${randomBytes(6).toString("hex")}`,
      name,
      repoKey,
      git: input.git === true,
      boundAt: now(),
    };
    desk.workspaces = [...(desk.workspaces ?? []), bound];
  });
  if (!updated || !bound) {
    throw new Error("desk not found");
  }
  return bound;
}

export function unbindDeskWorkspace(id: string, workspaceId: string): boolean {
  let removed = false;
  mutateDesk(id, (desk) => {
    const next = (desk.workspaces ?? []).filter((item) => item.id !== workspaceId);
    removed = next.length !== (desk.workspaces ?? []).length;
    desk.workspaces = next;
  });
  return removed;
}

export function findDeskWorkspace(desk: Desk, selector: { workspaceId?: string; repoKey?: string }): DeskWorkspace | undefined {
  const items = desk.workspaces ?? [];
  if (selector.workspaceId) {
    return items.find((item) => item.id === selector.workspaceId);
  }
  if (selector.repoKey) {
    return items.find((item) => item.repoKey === selector.repoKey);
  }
  return undefined;
}

export function deleteDesk(id: string, userId?: string): boolean {
  const items = readAll();
  const next = items.filter((item) => item.id !== id || (userId && item.userId !== userId));
  if (next.length === items.length) {
    return false;
  }
  writeAll(next);
  assignments.delete(id);
  inboxes.delete(id);
  return true;
}

export function hasInbox(deskId: string): boolean {
  return (inboxes.get(deskId)?.size ?? 0) > 0;
}

/** Attach a desk inbox stream. The returned function detaches it. */
export function openDeskInbox(deskId: string, sink: InboxSink): () => void {
  const set = inboxes.get(deskId) ?? new Set<InboxSink>();
  set.add(sink);
  inboxes.set(deskId, set);
  return () => {
    const current = inboxes.get(deskId);
    if (!current) {
      return;
    }
    current.delete(sink);
    if (current.size === 0) {
      inboxes.delete(deskId);
    }
  };
}

export function pushDeskInbox(deskId: string, event: DeskInboxEvent): boolean {
  const set = inboxes.get(deskId);
  if (!set || set.size === 0) {
    return false;
  }
  for (const sink of set) {
    try {
      sink(event);
    } catch {
      // a dead stream is dropped by its own close handler
    }
  }
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
    waiter.resolve(takeDeskAssignment(deskId));
  }
}

export function takeDeskAssignment(deskId: string): string | null {
  const queue = assignments.get(deskId) ?? [];
  const runId = queue.shift() ?? null;
  assignments.set(deskId, queue);
  return runId;
}

/** Drop a pending offer, e.g. after the desk rejected it. */
export function dropDeskAssignment(deskId: string, runId: string): void {
  const queue = assignments.get(deskId) ?? [];
  assignments.set(
    deskId,
    queue.filter((item) => item !== runId),
  );
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
  inboxes.clear();
}
