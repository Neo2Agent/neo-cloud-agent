import type { FollowUp, ImageRef, Run, RunSubscription, WorkerInbound } from "@neo-cloud-agent/contracts";
import { parseRunSource, runDisplayTitle } from "@neo-cloud-agent/contracts";
import type { ActiveTurn, PersistedRun } from "./persist.js";

/** Max stored sidebar title length. */
export const TITLE_MAX_LEN = 80;
/** Legacy fat `runs.record` that still embeds the queue. */
export const RECORD_VERSION_FAT = 1;
/** Queue lives in `run_queues`; `record` may still embed a replica (dual-write). */
export const RECORD_VERSION_SLIM = 2;
/** `record` is `{ version, run }` only. */
export const RECORD_VERSION_SLIM_RECORD = 3;
/** Backup table stage for the slim-record rewrite. */
export const BACKFILL_STAGE_SLIM_RECORD = "v3";
/** Internal object-store pointer prefix. Never accepted from clients. */
const INBOX_IMAGE_KEY_PREFIX = "obj:";
/** Rows migrated per backfill batch. */
export const BACKFILL_BATCH_SIZE = 200;
/** Fallback when prompt and title are empty. */
export const UNNAMED_RUN_TITLE = "未命名任务";
/** Client `ImageRef.data` must be a base64 payload. */
const INVALID_CLIENT_IMAGE_MESSAGE = "invalid image payload";

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
  document: PersistedRun | SlimRunDocument;
};

/** Indexed `runs` columns written on every save / backfill. */
export type RunIndexWrite = {
  title: string;
  status: Run["status"];
  projectId: string | null;
  createdAt: string;
  model: string;
  source: Run["source"];
  vmSlotId: string | null;
  prompt: string;
  usagePromptTokens: number | null;
  usageCompletionTokens: number | null;
  usageTotalTokens: number | null;
};

export class InvalidImageRefError extends Error {
  constructor() {
    super(INVALID_CLIENT_IMAGE_MESSAGE);
    this.name = "InvalidImageRefError";
  }
}

/** Stored `runs.title`: first line of the display source, compacted and truncated. */
export function runIndexTitle(run: { title?: string | null; prompt?: string | null }): string {
  const firstLine = runDisplayTitle(run).split(/\r?\n/, 1)[0] ?? "";
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

export function slimRecordJson(record: Pick<PersistedRun, "run">): string {
  return JSON.stringify(slimRunDocument(record));
}

export function runIndexWrite(run: Run): RunIndexWrite {
  return {
    title: runIndexTitle(run),
    status: run.status,
    projectId: run.projectId ?? null,
    createdAt: run.createdAt,
    model: run.model ?? "",
    source: run.source,
    vmSlotId: run.vmSlotId ?? null,
    prompt: run.prompt ?? "",
    usagePromptTokens: asToken(run.usage?.promptTokens),
    usageCompletionTokens: asToken(run.usage?.completionTokens),
    usageTotalTokens: asToken(run.usage?.totalTokens),
  };
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
    activeTurn: asObject(row.active_turn) as ActiveTurn | null,
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
): RunHydrationRow | null {
  const document = parseRecord(row.record);
  if (!document?.run?.id) {
    return null;
  }
  return {
    run: applyRunIndexColumns(document.run, row),
    recordVersion: recordVersionOf(row.record_version),
    document,
  };
}

export function applyRunIndexColumns(
  run: Run,
  row: {
    title?: unknown;
    status?: unknown;
    project_id?: unknown;
    created_at?: unknown;
    model?: unknown;
    source?: unknown;
    vm_slot_id?: unknown;
    prompt?: unknown;
    usage_prompt_tokens?: unknown;
    usage_completion_tokens?: unknown;
    usage_total_tokens?: unknown;
  },
): Run {
  const title = typeof row.title === "string" && row.title.trim() ? row.title : run.title;
  const status = typeof row.status === "string" && row.status ? (row.status as Run["status"]) : run.status;
  const projectId = row.project_id == null || row.project_id === "" ? (run.projectId ?? null) : String(row.project_id);
  const createdAt = asIsoTime(row.created_at) || run.createdAt;
  const model = typeof row.model === "string" && row.model ? row.model : run.model;
  const source = parseRunSource(row.source) ?? run.source;
  const vmSlotId = row.vm_slot_id == null || row.vm_slot_id === "" ? (run.vmSlotId ?? null) : String(row.vm_slot_id);
  const prompt = typeof row.prompt === "string" ? row.prompt : run.prompt;
  const usage = usageFromIndexRow(row) ?? run.usage ?? null;
  return {
    ...run,
    ...(title ? { title } : {}),
    status,
    projectId,
    createdAt,
    model,
    source,
    vmSlotId,
    prompt,
    usage,
  };
}

/**
 * Build a list `Run` from indexed columns only. Nested fields stay empty;
 * GET /v1/runs still reads the in-memory full Run.
 */
export function runFromIndexRow(row: Record<string, unknown>): Run | null {
  const id = typeof row.id === "string" && row.id ? row.id : "";
  if (!id) {
    return null;
  }
  const updatedAt = asIsoTime(row.updated_at) || asIsoTime(row.created_at);
  if (!updatedAt) {
    return null;
  }
  const createdAt = asIsoTime(row.created_at) || updatedAt;
  const usage = usageFromIndexRow(row);
  return {
    id,
    orgId: asString(row.org_id),
    userId: asString(row.user_id),
    envId: null,
    envVersionId: null,
    buildId: null,
    status: (typeof row.status === "string" && row.status ? row.status : "IDLE") as Run["status"],
    setupStatus: null,
    source: parseRunSource(row.source) ?? "api",
    projectId: row.project_id == null || row.project_id === "" ? null : String(row.project_id),
    model: asString(row.model),
    prompt: asString(row.prompt),
    title: typeof row.title === "string" && row.title.trim() ? row.title : undefined,
    branchName: null,
    baseBranch: null,
    repoUrls: [],
    pullRequests: [],
    workerHandle: null,
    vmSlotId: row.vm_slot_id == null || row.vm_slot_id === "" ? null : String(row.vm_slot_id),
    createdAt,
    updatedAt,
    idleAt: null,
    expiresAt: null,
    deletedAt: asIsoTime(row.deleted_at) || undefined,
    errorMessage: null,
    ...(usage ? { usage } : {}),
  };
}

/**
 * Hydrate rewrite is skipped when disk already has a queue file and the
 * same `updatedAt` + queue snapshot. Do not stringify the whole Run:
 * JSON key order from disk parse vs a constructed object is not stable.
 */
export function shouldPersistHydratedRun(incoming: PersistedRun, existing: PersistedRun | null): boolean {
  if (!existing?.run?.id) {
    return true;
  }
  if (existing.run.updatedAt !== incoming.run.updatedAt) {
    return true;
  }
  return (
    JSON.stringify(queueFromRecord(stripDeliveredImages(incoming))) !==
    JSON.stringify(queueFromRecord(stripDeliveredImages(existing)))
  );
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
    followUps: (record.followUps ?? []).map((item) => ({
      ...item,
      images: mapImages(item.images, item.id, "followup"),
    })),
    inbound: (record.inbound ?? []).map((item, index) => {
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
    followUps: (record.followUps ?? []).map((item) => {
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

export function recordVersionOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RECORD_VERSION_FAT;
}

export function runsBackupTableName(now = new Date(), stage = ""): string {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return stage ? `runs_backup_${stage}_${stamp}` : `runs_backup_${stamp}`;
}

/**
 * Probe / migrate-one / batch loop. Stops when the probe finds no pending rows.
 * A batch that migrates nothing also stops the loop, so a row that keeps
 * failing cannot spin here forever: it stays at the old version for next boot.
 */
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
    let migrated = 0;
    for (const row of batch) {
      const record = input.parseRecord(row.record);
      if (!record) {
        continue;
      }
      try {
        await input.migrateRow(row.id, record);
        migrated += 1;
      } catch (error) {
        console.error("run record backfill failed", row.id, error);
      }
    }
    if (migrated === 0) {
      console.error("run record backfill made no progress; leaving rows for the next boot");
      return;
    }
  }
}

function asToken(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asIsoTime(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function usageFromIndexRow(row: {
  usage_prompt_tokens?: unknown;
  usage_completion_tokens?: unknown;
  usage_total_tokens?: unknown;
}): Run["usage"] | null {
  const promptTokens = asToken(row.usage_prompt_tokens);
  const completionTokens = asToken(row.usage_completion_tokens);
  const totalTokens = asToken(row.usage_total_tokens);
  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return null;
  }
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens: totalTokens ?? 0,
  };
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
