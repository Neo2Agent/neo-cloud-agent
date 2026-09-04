import type { FollowUp, ImageRef, Run, RunSubscription, WorkerInbound } from "@neo-cloud-agent/contracts";
import type { ActiveTurn, PersistedRun } from "./persist.js";

/** Max stored sidebar title length. */
export const TITLE_MAX_LEN = 80;
/** Legacy fat `runs.record` that still embeds the queue. */
export const RECORD_VERSION_FAT = 1;
/** Slim document; queue lives in `run_queues` / `.queue.json`. */
export const RECORD_VERSION_SLIM = 2;
/** Internal object-store pointer prefix. Never accepted from clients. */
export const INBOX_IMAGE_KEY_PREFIX = "obj:";
/** Rows migrated per backfill batch. */
export const BACKFILL_BATCH_SIZE = 200;
/** Fallback when prompt and title are empty. */
export const UNNAMED_RUN_TITLE = "未命名任务";
/** Client `ImageRef.data` must be a base64 payload. */
export const INVALID_CLIENT_IMAGE_MESSAGE = "invalid image payload";

export type SlimRunDocument = {
  version: 1;
  run: Run;
};

export type RunQueueDocument = {
  followUps: FollowUp[];
  inbound: WorkerInbound[];
  subscriptions: RunSubscription[];
  activeTurn: ActiveTurn | null;
};

export type RunHydrationRow = {
  run: Run;
  recordVersion: number;
  document: PersistedRun | SlimRunDocument | null;
};

export class InvalidImageRefError extends Error {
  readonly status = 400;

  constructor(message = INVALID_CLIENT_IMAGE_MESSAGE) {
    super(message);
    this.name = "InvalidImageRefError";
  }
}

/** Prefer a non-empty title; otherwise first prompt line, truncated. */
export function runIndexTitle(run: { title?: string | null; prompt?: string | null }): string {
  const existing = (run.title ?? "").replace(/\s+/g, " ").trim();
  if (existing) {
    return existing.slice(0, TITLE_MAX_LEN);
  }
  const firstLine = (run.prompt ?? "").split(/\r?\n/, 1)[0] ?? "";
  const compact = firstLine.replace(/\s+/g, " ").trim();
  return (compact || UNNAMED_RUN_TITLE).slice(0, TITLE_MAX_LEN);
}

export function isObjectImageRef(data: string): boolean {
  return data.startsWith(INBOX_IMAGE_KEY_PREFIX);
}

export function objectImageData(key: string): string {
  return `${INBOX_IMAGE_KEY_PREFIX}${key}`;
}

export function parseObjectImageKey(data: string): string | null {
  if (!isObjectImageRef(data)) {
    return null;
  }
  const key = data.slice(INBOX_IMAGE_KEY_PREFIX.length).trim();
  return key || null;
}

export function inboxImageKey(runId: string, name: string): string {
  return `runs/${runId}/inbox/${name}`;
}

export function inboxPrefix(runId: string): string {
  return `runs/${runId}/inbox/`;
}

/** True only for `runs/<this runId>/inbox/<file>` with no traversal. */
export function isOwnedInboxKey(runId: string, key: string): boolean {
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    return false;
  }
  const prefix = inboxPrefix(runId);
  if (!key.startsWith(prefix)) {
    return false;
  }
  const name = key.slice(prefix.length);
  return Boolean(name) && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

export function assertClientImages(images?: ImageRef[]): void {
  if (!images?.length) {
    return;
  }
  for (const image of images) {
    if (typeof image?.data === "string" && isObjectImageRef(image.data)) {
      throw new InvalidImageRefError();
    }
  }
}

export function emptyRunQueue(): RunQueueDocument {
  return { followUps: [], inbound: [], subscriptions: [], activeTurn: null };
}

export function slimRunDocument(record: Pick<PersistedRun, "run">): SlimRunDocument {
  return { version: 1, run: record.run };
}

export function queueFromRecord(record: PersistedRun): RunQueueDocument {
  return {
    followUps: record.followUps ?? [],
    inbound: record.inbound ?? [],
    subscriptions: record.subscriptions ?? [],
    activeTurn: record.activeTurn ?? null,
  };
}

/**
 * LEFT JOIN all-null queue columns are missing, not an empty written queue.
 * @returns null when every queue field is null/undefined
 */
export function parseQueue(
  row:
    | {
        follow_ups?: unknown;
        inbound?: unknown;
        subscriptions?: unknown;
        active_turn?: unknown;
      }
    | null
    | undefined,
): RunQueueDocument | null {
  if (!row) {
    return null;
  }
  if (row.follow_ups == null && row.inbound == null && row.subscriptions == null && row.active_turn == null) {
    return null;
  }
  return {
    followUps: asArray<FollowUp>(row.follow_ups),
    inbound: asArray<WorkerInbound>(row.inbound),
    subscriptions: asArray<RunSubscription>(row.subscriptions),
    activeTurn: row.active_turn == null ? null : ((asObject(row.active_turn) as ActiveTurn | null) ?? null),
  };
}

export function mergeStoredRun(
  record: PersistedRun | SlimRunDocument | null,
  queue: RunQueueDocument | null,
  recordVersion: number,
): PersistedRun | null {
  if (!record?.run?.id) {
    return null;
  }
  if (recordVersion >= RECORD_VERSION_SLIM) {
    const next = queue ?? emptyRunQueue();
    return {
      version: 1,
      run: record.run,
      followUps: next.followUps,
      inbound: next.inbound,
      subscriptions: next.subscriptions,
      activeTurn: next.activeTurn,
    };
  }
  const fat = record as PersistedRun;
  return {
    version: 1,
    run: record.run,
    followUps: Array.isArray(fat.followUps) ? fat.followUps : [],
    inbound: Array.isArray(fat.inbound) ? fat.inbound : [],
    subscriptions: Array.isArray(fat.subscriptions) ? fat.subscriptions : [],
    activeTurn: fat.activeTurn ?? null,
  };
}

export function hydrationRowFromStore(
  row: Record<string, unknown>,
  parseRecord: (value: unknown) => PersistedRun | null,
  parseRun: (value: unknown) => Run | null,
): RunHydrationRow | null {
  const document = parseRecord(row.record);
  const embedded = document?.run ?? parseRun(extractRun(row.record));
  if (!embedded?.id) {
    return null;
  }
  return {
    run: applyRunIndexColumns(embedded, row),
    recordVersion: recordVersionOf(row.record_version),
    document: document ?? (embedded ? { version: 1, run: embedded } : null),
  };
}

function extractRun(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as { run?: unknown };
  return record.run ?? value;
}

export function applyRunIndexColumns(
  run: Run,
  row: { title?: unknown; status?: unknown; project_id?: unknown },
): Run {
  const title = typeof row.title === "string" && row.title.trim() ? row.title : run.title;
  const status = typeof row.status === "string" && row.status ? (row.status as Run["status"]) : run.status;
  const projectId = row.project_id == null || row.project_id === "" ? (run.projectId ?? null) : String(row.project_id);
  return {
    ...run,
    ...(title ? { title } : {}),
    status,
    projectId,
  };
}

export function collectObjectKeys(record: PersistedRun): Set<string> {
  const keys = new Set<string>();
  const take = (images?: ImageRef[]) => {
    for (const image of images ?? []) {
      const key = parseObjectImageKey(image.data);
      if (key) {
        keys.add(key);
      }
    }
  };
  for (const item of record.followUps ?? []) {
    take(item.images);
  }
  for (const item of record.inbound ?? []) {
    if ("images" in item) {
      take(item.images);
    }
  }
  take(record.activeTurn?.images);
  return keys;
}

export function mapRecordImages(
  record: PersistedRun,
  mapImages: (images: ImageRef[] | undefined, ownerId: string, kind: string) => ImageRef[] | undefined,
): PersistedRun {
  return {
    ...record,
    followUps: record.followUps.map((item) => ({
      ...item,
      images: mapImages(item.images, item.id, "followup"),
    })),
    inbound: record.inbound.map((item, index) => {
      if (!("images" in item)) {
        return item;
      }
      const ownerId = item.followUpId ?? `inbound-${index + 1}`;
      const kind = item.followUpId ? "followup" : "inbound";
      return { ...item, images: mapImages(item.images, ownerId, kind) };
    }),
    activeTurn: record.activeTurn
      ? {
          ...record.activeTurn,
          images: mapImages(record.activeTurn.images, `active-${record.activeTurn.type}`, "active"),
        }
      : record.activeTurn,
  };
}

/** Drop image bytes/keys from delivered or cancelled follow-ups; keep the entries. */
export function stripDeliveredImages(record: PersistedRun): PersistedRun {
  return {
    ...record,
    followUps: record.followUps.map((item) => {
      if (item.status !== "delivered" && item.status !== "cancelled") {
        return item;
      }
      const { images: _images, ...rest } = item;
      return rest;
    }),
  };
}

/** Resolve then drop any leftover `obj:` so clients never see internal keys. */
export function publicFollowUps(
  items: FollowUp[],
  resolve: (images?: ImageRef[]) => ImageRef[] | undefined,
): FollowUp[] {
  return items.map((item) => ({
    ...item,
    images: resolve(item.images)?.filter((image) => image.data && !isObjectImageRef(image.data)),
  }));
}

export function asJsonArray<T>(value: unknown): T[] {
  return asArray<T>(value);
}

export function recordVersionOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RECORD_VERSION_FAT;
}

export function runsBackupTableName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `runs_backup_${stamp}`;
}

/** Probe / migrate-one / batch loop. Stops when the probe finds no pending rows. */
export async function backfillRunRecords(input: {
  hasPending: () => Promise<boolean>;
  loadBatch: () => Promise<Array<{ id: string; record: unknown }>>;
  migrateRow: (id: string, record: PersistedRun) => Promise<void>;
  parseRecord: (value: unknown) => PersistedRun | null;
}): Promise<void> {
  while (await input.hasPending()) {
    const batch = await input.loadBatch();
    if (batch.length === 0) {
      return;
    }
    for (const row of batch) {
      const record = input.parseRecord(row.record);
      if (!record) {
        continue;
      }
      try {
        await input.migrateRow(row.id, record);
      } catch (error) {
        console.error("run record backfill failed", row.id, error);
      }
    }
  }
}

function asArray<T>(value: unknown): T[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function asObject(value: unknown): object | null {
  const parsed = parseJsonValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}
