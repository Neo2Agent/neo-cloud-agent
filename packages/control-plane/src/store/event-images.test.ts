import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RunEvent } from "@neo-cloud-agent/contracts";
import { getObjectSync, putObjectSync, removeObjectPrefixSync } from "../objects/fs.js";
import {
  backfillEventImageRows,
  EVENT_IMAGE_VERSION,
  eventHasImages,
  eventImageKey,
  eventsBackupTableName,
  eventsImagePrefix,
  isOwnedEventKey,
  eventNeedsImageBackfill,
  persistEventImages,
  reclaimEventImages,
  resolveEventImageData,
  resolveSnapshotImagesForClient,
  resolveTranscriptImage,
} from "./event-images.js";
import { inboxImageKey, inboxPrefix, isObjectImageRef, objectImageData } from "./run-record.js";

function eventWithImages(images: Array<{ mediaType: string; data: string }>, id = "evt-1"): RunEvent {
  return {
    id,
    runId: "run-1",
    createdAt: "2026-09-04T00:00:00.000Z",
    category: "agent_run",
    level: "info",
    kind: "user.message",
    title: "User message",
    data: { text: "看这张", images },
  };
}

test("isOwnedEventKey only accepts this run's events prefix", () => {
  assert.equal(isOwnedEventKey("run-1", eventImageKey("run-1", "evt-1", 0)), true);
  assert.equal(isOwnedEventKey("run-1", eventImageKey("run-2", "evt-1", 0)), false);
  assert.equal(isOwnedEventKey("run-1", inboxImageKey("run-1", "followup-f1-1")), false);
  assert.equal(isOwnedEventKey("run-1", "runs/run-1/events/../inbox/x"), false);
  assert.equal(isOwnedEventKey("run-1", "/runs/run-1/events/x"), false);
});

test("persistEventImages offloads base64 and is idempotent", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-evt-img-"));
  const first = persistEventImages(eventWithImages([{ mediaType: "image/png", data: "aW1nZGF0YQ" }]), runsDir);
  const data = (first.data?.images as Array<{ data: string }>)[0]?.data ?? "";
  assert.equal(isObjectImageRef(data), true);
  assert.equal(data, objectImageData(eventImageKey("run-1", "evt-1", 0)));
  assert.equal(getObjectSync(runsDir, eventImageKey("run-1", "evt-1", 0)), "aW1nZGF0YQ");
  const again = persistEventImages(first, runsDir);
  assert.equal((again.data?.images as Array<{ data: string }>)[0]?.data, data);
  assert.equal(eventHasImages(first), true);
});

test("persistEventImages copies an inbox key and survives inbox GC", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-evt-copy-"));
  const inbox = inboxImageKey("run-1", "followup-f1-1");
  putObjectSync(runsDir, inbox, "aW1nZGF0YQ");
  const slim = persistEventImages(
    eventWithImages([{ mediaType: "image/png", data: objectImageData(inbox) }]),
    runsDir,
  );
  const data = (slim.data?.images as Array<{ data: string }>)[0]?.data ?? "";
  assert.equal(data, objectImageData(eventImageKey("run-1", "evt-1", 0)));
  removeObjectPrefixSync(runsDir, inboxPrefix("run-1"));
  assert.equal(resolveEventImageData("run-1", data, runsDir), "aW1nZGF0YQ");
});

test("persistEventImages drops a foreign object key", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-evt-drop-"));
  const slim = persistEventImages(
    eventWithImages([{ mediaType: "image/png", data: "obj:runs/other/inbox/x" }]),
    runsDir,
  );
  assert.equal(slim.data?.images, undefined);
});

test("resolveEventImageData rejects a foreign key and accepts leftover base64", () => {
  assert.equal(resolveEventImageData("run-1", "obj:runs/other/events/x"), null);
  assert.equal(resolveEventImageData("run-1", "aW1nZGF0YQ"), "aW1nZGF0YQ");
});

test("reclaimEventImages only removes the events prefix", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-evt-reclaim-"));
  persistEventImages(eventWithImages([{ mediaType: "image/png", data: "aW1nZGF0YQ" }]), runsDir);
  putObjectSync(runsDir, inboxImageKey("run-1", "keep"), "cXVldWU");
  reclaimEventImages("run-1", runsDir);
  assert.equal(getObjectSync(runsDir, eventImageKey("run-1", "evt-1", 0)), null);
  assert.equal(getObjectSync(runsDir, inboxImageKey("run-1", "keep")), "cXVldWU");
  assert.equal(eventsImagePrefix("run-1").endsWith("events/"), true);
});

test("eventNeedsImageBackfill is false for owned event keys", () => {
  const fat = eventWithImages([{ mediaType: "image/png", data: "aW1nZGF0YQ" }]);
  assert.equal(eventNeedsImageBackfill(fat), true);
  const slim = persistEventImages(fat, mkdtempSync(path.join(tmpdir(), "neo-evt-need-")));
  assert.equal(eventNeedsImageBackfill(slim), false);
});

test("resolveTranscriptImage reads obj: and falls back to the event stream", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "neo-evt-tx-"));
  const slim = persistEventImages(eventWithImages([{ mediaType: "image/png", data: "aW1nZGF0YQ" }]), runsDir);
  const data = (slim.data?.images as Array<{ data: string }>)[0]?.data ?? "";
  let reads = 0;
  const fromSnap = resolveTranscriptImage(
    "run-1",
    "evt-1",
    0,
    { messages: [{ id: "evt-1", role: "user", text: "看这张", createdAt: slim.createdAt, images: slim.data?.images as Array<{ mediaType: string; data: string }> }] },
    () => {
      reads += 1;
      return [slim];
    },
    runsDir,
  );
  assert.equal(fromSnap?.data, "aW1nZGF0YQ");
  assert.equal(reads, 0);
  const fromEvent = resolveTranscriptImage(
    "run-1",
    "evt-1",
    0,
    { messages: [{ id: "evt-1", role: "user", text: "看这张", createdAt: slim.createdAt, images: [{ mediaType: "image/png", data: "", href: "/x" }] }] },
    () => [slim],
    runsDir,
  );
  assert.equal(fromEvent?.data, "aW1nZGF0YQ");
  const client = resolveSnapshotImagesForClient(
    {
      runId: "run-1",
      seq: 1,
      lastEventId: "evt-1",
      messages: [{ id: "evt-1", role: "user", text: "看这张", createdAt: slim.createdAt, images: [{ mediaType: "image/png", data }] }],
    },
    runsDir,
  );
  assert.equal(client.messages[0]?.images?.[0]?.data, "aW1nZGF0YQ");
  assert.equal(data.startsWith("obj:"), true);
});

test("eventsBackupTableName is date-stamped", () => {
  assert.equal(eventsBackupTableName(new Date("2026-09-04T12:00:00.000Z")), "events_backup_img_20260904");
});

test("backfillEventImageRows stops when a batch migrates nothing", async () => {
  let pending = true;
  const calls: string[] = [];
  await backfillEventImageRows({
    hasPending: async () => pending,
    loadBatch: async () => [{ runId: "run-1", eventId: "evt-1", body: { id: "evt-1", runId: "run-1" } }],
    parseEvent: (value) => value as RunEvent,
    migrateRow: async () => {
      calls.push("fail");
      throw new Error("stuck");
    },
  });
  assert.equal(calls.length, 1);
  pending = false;
  assert.equal(EVENT_IMAGE_VERSION, 1);
});
