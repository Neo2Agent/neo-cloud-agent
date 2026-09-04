import type { FollowUp, ImageRef, Run, RunSubscription, WorkerInbound } from "@neo-cloud-agent/contracts";
import type { ActiveTurn, PersistedRun } from "./persist.js";

export type RunQueueState = {
  followUps: FollowUp[];
  inbound: WorkerInbound[];
  subscriptions: RunSubscription[];
  activeTurn: ActiveTurn | null;
};

export const INBOX_IMAGE_KEY_PREFIX = "obj:";

export function emptyRunQueue(): RunQueueState {
  return { followUps: [], inbound: [], subscriptions: [], activeTurn: null };
}

export function asPersistedRun(value: unknown): PersistedRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as PersistedRun;
  return record.run?.id ? record : null;
}

export function asRun(value: unknown): Run | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const run = value as Run;
  return run.id && run.prompt ? run : null;
}

export function parseJson<T>(value: unknown, map: (item: unknown) => T | null): T | null {
  if (typeof value === "string") {
    try {
      return map(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return map(value);
}

export function runIndexTitle(run: Pick<Run, "title" | "prompt">): string {
  const titled = run.title?.replace(/\s+/g, " ").trim();
  if (titled) {
    return titled.slice(0, 80);
  }
  const line = (run.prompt ?? "").split(/\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  return line.slice(0, 80) || "未命名任务";
}

export function slimRunDocument(record: PersistedRun): { version: 1; run: Run } {
  return { version: 1, run: record.run };
}

export function queueFromRecord(record: PersistedRun): RunQueueState {
  return {
    followUps: record.followUps ?? [],
    inbound: record.inbound ?? [],
    subscriptions: record.subscriptions ?? [],
    activeTurn: record.activeTurn ?? null,
  };
}

export function mergeRunAndQueue(run: Run, queue?: RunQueueState | null): PersistedRun {
  const next = queue ?? emptyRunQueue();
  return {
    version: 1,
    run,
    followUps: next.followUps,
    inbound: next.inbound,
    subscriptions: next.subscriptions,
    activeTurn: next.activeTurn,
  };
}

export function mergeStoredRun(record: unknown, queue?: unknown): PersistedRun | null {
  const parsed = parseJson(record, asPersistedRun);
  if (!parsed?.run?.id) {
    const run = parseJson(record, asRun);
    if (!run) {
      return null;
    }
    return mergeRunAndQueue(run, parseQueue(queue));
  }
  const storedQueue = parseQueue(queue);
  if (storedQueue) {
    return mergeRunAndQueue(parsed.run, storedQueue);
  }
  return {
    version: 1,
    run: parsed.run,
    followUps: parsed.followUps ?? [],
    inbound: parsed.inbound ?? [],
    subscriptions: parsed.subscriptions ?? [],
    activeTurn: parsed.activeTurn ?? null,
  };
}

export function parseQueue(value: unknown): RunQueueState | null {
  if (value == null) {
    return null;
  }
  const raw = typeof value === "string" ? parseJson(value, (item) => item) : value;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Partial<RunQueueState> & {
    follow_ups?: FollowUp[] | null;
    active_turn?: ActiveTurn | null;
  };
  const followUps = Array.isArray(item.followUps) ? item.followUps : Array.isArray(item.follow_ups) ? item.follow_ups : undefined;
  const inbound = Array.isArray(item.inbound) ? item.inbound : undefined;
  const subscriptions = Array.isArray(item.subscriptions) ? item.subscriptions : undefined;
  const rawActive = item.activeTurn !== undefined ? item.activeTurn : item.active_turn;
  const activeTurn = rawActive == null ? undefined : rawActive;
  if (followUps === undefined && inbound === undefined && subscriptions === undefined && activeTurn === undefined) {
    return null;
  }
  return {
    followUps: followUps ?? [],
    inbound: inbound ?? [],
    subscriptions: subscriptions ?? [],
    activeTurn: activeTurn ?? null,
  };
}

export function recordHasEmbeddedQueue(record: PersistedRun): boolean {
  return Boolean(
    record.followUps?.length ||
      record.inbound?.length ||
      record.subscriptions?.length ||
      record.activeTurn,
  );
}

/** Legacy fat `runs.record` documents still carry these keys even when the arrays are empty. */
export function recordHasQueueKeys(value: unknown): boolean {
  const record = typeof value === "string" ? parseJson(value, (item) => item) : value;
  if (!record || typeof record !== "object") {
    return false;
  }
  const item = record as Record<string, unknown>;
  return "followUps" in item || "inbound" in item || "subscriptions" in item || "activeTurn" in item;
}

export function isInboxImageKey(data: string): boolean {
  return data.startsWith(INBOX_IMAGE_KEY_PREFIX);
}

export function inboxImageObjectKey(runId: string, name: string): string {
  return `runs/${runId}/inbox/${name}`;
}

export function inboxImageRefKey(runId: string, name: string): string {
  return `${INBOX_IMAGE_KEY_PREFIX}${inboxImageObjectKey(runId, name)}`;
}

export function inboxImageObjectKeyFromRef(data: string): string | null {
  if (!isInboxImageKey(data)) {
    return null;
  }
  return data.slice(INBOX_IMAGE_KEY_PREFIX.length);
}

function mapImages(images: ImageRef[] | undefined, map: (image: ImageRef, index: number) => ImageRef): ImageRef[] | undefined {
  if (!images?.length) {
    return images;
  }
  return images.map(map);
}

export function mapRecordImages(record: PersistedRun, map: (runId: string, image: ImageRef, name: string) => ImageRef): PersistedRun {
  const runId = record.run.id;
  let imageSeq = 0;
  const nextName = (label: string) => {
    imageSeq += 1;
    return `${label}-${imageSeq}`;
  };
  return {
    ...record,
    followUps: (record.followUps ?? []).map((item) => ({
      ...item,
      images: mapImages(item.images, (image) => map(runId, image, nextName(`followup-${item.id}`))),
    })),
    inbound: (record.inbound ?? []).map((item) => {
      if (!("images" in item)) {
        return item;
      }
      return {
        ...item,
        images: mapImages(item.images, (image) => map(runId, image, nextName(`inbound-${item.type}`))),
      };
    }),
    activeTurn: record.activeTurn
      ? {
          ...record.activeTurn,
          images: mapImages(record.activeTurn.images, (image) => map(runId, image, nextName("active"))),
        }
      : record.activeTurn,
  };
}

export function overlayRunIndex(run: Run, row?: { title?: unknown; status?: unknown; project_id?: unknown }): Run {
  const title = typeof row?.title === "string" && row.title.trim() ? row.title.trim() : run.title;
  const status = typeof row?.status === "string" && row.status ? (row.status as Run["status"]) : run.status;
  const projectId =
    typeof row?.project_id === "string" && row.project_id
      ? row.project_id
      : row?.project_id === null
        ? null
        : run.projectId;
  return {
    ...run,
    ...(title ? { title } : {}),
    status,
    projectId: projectId ?? run.projectId ?? null,
  };
}
