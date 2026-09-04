import type { RunEvent } from "@neo-cloud-agent/contracts";
import { buildTranscriptSnapshot } from "../events/transcript.js";
import {
  listEventObjectKeys,
  listInboxObjectKeys,
  loadPersistedEvents,
  loadPersistedQueue,
  loadPersistedRun,
  loadPersistedRunDocument,
  loadPersistedRunRaw,
  loadSessionFiles,
  persistRunRecord,
  persistSessionFiles,
  readEventObject,
  readInboxObject,
  replacePersistedEvents,
  writeEventObject,
  writeInboxObject,
  type PersistedRun,
} from "../store/persist.js";
import {
  mergeStoredRun,
  RECORD_VERSION_FAT,
  RECORD_VERSION_SLIM,
  slimRunDocument,
} from "../store/run-record.js";
import { artifactKey, getObjectStore } from "./store.js";

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleArchive(runId: string): void {
  if (getObjectStore().kind === "none") {
    return;
  }
  const previous = timers.get(runId);
  if (previous) {
    clearTimeout(previous);
  }
  const timer = setTimeout(() => {
    timers.delete(runId);
    void archiveRunArtifacts(runId).catch((error: unknown) => {
      console.error("failed to archive run artifacts", error);
    });
  }, 250);
  timer.unref();
  timers.set(runId, timer);
}

export async function archiveRunArtifacts(runId: string): Promise<void> {
  const store = getObjectStore();
  if (store.kind === "none") {
    return;
  }
  const events = loadPersistedEvents(runId);
  const document = loadPersistedRunDocument(runId);
  const queue = loadPersistedQueue(runId);
  const session = loadSessionFiles(runId);
  const snapshot = buildTranscriptSnapshot(runId, events);
  await store.put(artifactKey(runId, "events.jsonl"), events.map((item) => JSON.stringify(item)).join("\n") + (events.length ? "\n" : ""));
  await store.put(artifactKey(runId, "snapshot.json"), `${JSON.stringify(snapshot)}\n`, "application/json");
  if (document) {
    await store.put(artifactKey(runId, "record.json"), `${JSON.stringify(slimRunDocument(document))}\n`, "application/json");
  }
  if (queue) {
    await store.put(artifactKey(runId, "queue.json"), `${JSON.stringify(queue)}\n`, "application/json");
  }
  await store.put(artifactKey(runId, "session-manifest.json"), `${JSON.stringify(session.map((file) => file.name))}\n`, "application/json");
  for (const file of session) {
    await store.put(artifactKey(runId, `session/${file.name}`), file.content);
  }
  for (const key of listInboxObjectKeys(runId)) {
    const body = readInboxObject(key);
    if (body != null) {
      await store.put(key, body);
    }
  }
  for (const key of listEventObjectKeys(runId)) {
    const body = readEventObject(key);
    if (body != null) {
      await store.put(key, body);
    }
  }
}

export async function loadArchivedArtifacts(runId: string): Promise<{
  record: PersistedRun | null;
  events: RunEvent[];
  session: Array<{ name: string; content: string }>;
  inbox: Array<{ key: string; body: string }>;
  eventImages: Array<{ key: string; body: string }>;
} | null> {
  const store = getObjectStore();
  const eventsRaw = await store.get(artifactKey(runId, "events.jsonl"));
  const recordRaw = await store.get(artifactKey(runId, "record.json"));
  if (!eventsRaw && !recordRaw) {
    return null;
  }
  const events = (eventsRaw ?? "")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunEvent);
  const document = recordRaw ? (JSON.parse(recordRaw) as PersistedRun) : null;
  const queueRaw = await store.get(artifactKey(runId, "queue.json"));
  const queue = queueRaw ? (JSON.parse(queueRaw) as ReturnType<typeof loadPersistedQueue>) : null;
  const record = document
    ? mergeStoredRun(document, queue, queue ? RECORD_VERSION_SLIM : RECORD_VERSION_FAT)
    : null;
  const manifestRaw = await store.get(artifactKey(runId, "session-manifest.json"));
  const names = manifestRaw ? (JSON.parse(manifestRaw) as string[]) : [];
  const session: Array<{ name: string; content: string }> = [];
  for (const name of names) {
    const content = await store.get(artifactKey(runId, `session/${name}`));
    if (typeof content === "string") {
      session.push({ name, content });
    }
  }
  const inbox: Array<{ key: string; body: string }> = [];
  for (const key of await store.list(`runs/${runId}/inbox/`)) {
    const body = await store.get(key);
    if (typeof body === "string") {
      inbox.push({ key, body });
    }
  }
  const eventImages: Array<{ key: string; body: string }> = [];
  for (const key of await store.list(`runs/${runId}/events/`)) {
    const body = await store.get(key);
    if (typeof body === "string") {
      eventImages.push({ key, body });
    }
  }
  return { record, events, session, inbox, eventImages };
}

export async function restoreArchivedArtifacts(runId: string): Promise<{
  record: PersistedRun | null;
  events: RunEvent[];
} | null> {
  const loaded = await loadArchivedArtifacts(runId);
  if (!loaded) {
    return null;
  }
  for (const item of loaded.inbox) {
    writeInboxObject(item.key, item.body);
  }
  for (const item of loaded.eventImages) {
    writeEventObject(item.key, item.body);
  }
  if (loaded.record) {
    const current = loadPersistedRunRaw(runId);
    if (current?.run?.deletedAt) {
      return { record: current, events: loaded.events };
    }
    persistRunRecord(loaded.record);
  }
  if (loaded.events.length > 0) {
    replacePersistedEvents(runId, loaded.events);
  }
  if (loaded.session.length > 0) {
    persistSessionFiles(runId, loaded.session);
  }
  return { record: loaded.record, events: loaded.events };
}
