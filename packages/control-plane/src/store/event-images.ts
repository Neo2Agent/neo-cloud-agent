import type { ImageRef, RunEvent, TranscriptSnapshot } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { getObjectSync, putObjectSync, removeObjectPrefixSync } from "../objects/fs.js";
import {
  BACKFILL_BATCH_SIZE,
  isObjectImageRef,
  isOwnedInboxKey,
  objectImageData,
  parseObjectImageKey,
} from "./run-record.js";

/** Persisted and hot events store object pointers, not pixels. */
export const EVENT_IMAGE_VERSION = 1;
/** Rows migrated per events.body image backfill batch. */
export const EVENT_IMAGE_BACKFILL_BATCH = BACKFILL_BATCH_SIZE;

export function eventsImagePrefix(runId: string): string {
  return `runs/${runId}/events/`;
}

export function eventImageKey(runId: string, eventId: string, index: number): string {
  return `runs/${runId}/events/${eventId}-${index + 1}`;
}

export function eventsBackupTableName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `events_backup_img_${stamp}`;
}

/** True only for `runs/<this runId>/events/<file>` with no traversal. */
export function isOwnedEventKey(runId: string, key: string): boolean {
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    return false;
  }
  const prefix = eventsImagePrefix(runId);
  if (!key.startsWith(prefix)) {
    return false;
  }
  const name = key.slice(prefix.length);
  return Boolean(name) && !name.includes("/") && !name.includes("\\") && !name.includes("..");
}

export function readEventImages(event: RunEvent): ImageRef[] {
  const raw = event.data?.images;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (item): item is ImageRef =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { mediaType?: unknown }).mediaType === "string" &&
      typeof (item as { data?: unknown }).data === "string",
  );
}

export function eventHasImages(event: RunEvent): boolean {
  return readEventImages(event).length > 0;
}

/** True when pixels are still inline or the pointer is not this run's events prefix. */
export function eventNeedsImageBackfill(event: RunEvent): boolean {
  return readEventImages(event).some((image) => {
    const key = parseObjectImageKey(image.data);
    return !key || !isOwnedEventKey(event.runId, key);
  });
}

/**
 * Copy pixels to `runs/<runId>/events/` and leave only `obj:` pointers on the event.
 * Inbox keys are copied, never reused, so queue GC cannot blank the transcript.
 */
export function persistEventImages(event: RunEvent, runsDir?: string): RunEvent {
  const images = readEventImages(event);
  if (images.length === 0) {
    return event;
  }
  const dir = runsDir ?? getConfig().runsDir;
  const next: ImageRef[] = [];
  for (const [index, image] of images.entries()) {
    const stored = persistOneEventImage(event, image, index, dir);
    if (stored) {
      next.push(stored);
    }
  }
  return {
    ...event,
    data: {
      ...event.data,
      images: next.length > 0 ? next : undefined,
    },
  };
}

function persistOneEventImage(event: RunEvent, image: ImageRef, index: number, runsDir: string): ImageRef | null {
  const dest = eventImageKey(event.runId, event.id, index);
  const key = parseObjectImageKey(image.data);
  if (key) {
    if (isOwnedEventKey(event.runId, key)) {
      return image;
    }
    if (!isOwnedInboxKey(event.runId, key)) {
      return null;
    }
    const body = getObjectSync(runsDir, key);
    if (body == null) {
      return null;
    }
    putObjectSync(runsDir, dest, body);
    return { mediaType: image.mediaType, data: objectImageData(dest) };
  }
  if (!image.data.trim()) {
    return null;
  }
  putObjectSync(runsDir, dest, image.data);
  return { mediaType: image.mediaType, data: objectImageData(dest) };
}

/** Bytes for a stored pointer or a leftover base64 payload. Never trusts a foreign key. */
export function resolveEventImageData(runId: string, data: string, runsDir?: string): string | null {
  const key = parseObjectImageKey(data);
  if (!key) {
    if (!data || isObjectImageRef(data)) {
      return null;
    }
    return data;
  }
  if (!isOwnedEventKey(runId, key) && !isOwnedInboxKey(runId, key)) {
    return null;
  }
  return getObjectSync(runsDir ?? getConfig().runsDir, key);
}

/**
 * Bytes for `GET .../transcript/images`. Snapshot pointers first; if the page
 * was slimmed to href, look up the event by message id. Does not hydrate RAM.
 */
export function resolveTranscriptImage(
  runId: string,
  messageId: string,
  index: number,
  snapshot: Pick<TranscriptSnapshot, "messages">,
  events: RunEvent[],
  runsDir?: string,
): { mediaType: string; data: string } | null {
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }
  const fromSnap = snapshot.messages.find((item) => item.id === messageId)?.images?.[index];
  if (fromSnap) {
    const data = resolveEventImageData(runId, fromSnap.data, runsDir);
    if (data) {
      return { mediaType: fromSnap.mediaType, data };
    }
  }
  const event = events.find((item) => item.id === messageId);
  const fromEvent = event ? readEventImages(event)[index] : undefined;
  if (!fromEvent) {
    return null;
  }
  const data = resolveEventImageData(runId, fromEvent.data, runsDir);
  return data ? { mediaType: fromEvent.mediaType, data } : null;
}

/** Response copy only: turn `obj:` pointers into base64 so clients never see keys. */
export function resolveSnapshotImagesForClient(
  snapshot: TranscriptSnapshot,
  runsDir?: string,
): TranscriptSnapshot {
  const messages = snapshot.messages.map((message) => {
    if (!message.images?.length) {
      return message;
    }
    let changed = false;
    const images = message.images.map((image) => {
      const data = resolveEventImageData(snapshot.runId, image.data, runsDir);
      if (!data || data === image.data) {
        return image;
      }
      changed = true;
      return { ...image, data };
    });
    return changed ? { ...message, images } : message;
  });
  return { ...snapshot, messages };
}

export function reclaimEventImages(runId: string, runsDir?: string): void {
  removeObjectPrefixSync(runsDir ?? getConfig().runsDir, eventsImagePrefix(runId));
}

/**
 * Probe / migrate-one / batch loop for `events.image_version`.
 * A batch that migrates nothing stops, so a stuck row cannot spin boot.
 */
export async function backfillEventImageRows(input: {
  hasPending: () => Promise<boolean>;
  loadBatch: () => Promise<Array<{ runId: string; eventId: string; body: unknown }>>;
  migrateRow: (row: { runId: string; eventId: string; event: RunEvent }) => Promise<void>;
  parseEvent: (value: unknown) => RunEvent | null;
}): Promise<void> {
  while (await input.hasPending()) {
    const batch = await input.loadBatch();
    if (batch.length === 0) {
      return;
    }
    let migrated = 0;
    for (const row of batch) {
      const event = input.parseEvent(row.body);
      if (!event?.id || !event.runId) {
        continue;
      }
      try {
        await input.migrateRow({ runId: row.runId, eventId: row.eventId, event });
        migrated += 1;
      } catch (error) {
        console.error("event image backfill failed", row.runId, row.eventId, error);
      }
    }
    if (migrated === 0) {
      console.error("event image backfill made no progress; leaving rows for the next boot");
      return;
    }
  }
}
