import type { RunEvent } from "@neo-cloud-agent/contracts";
import { buildTranscriptSnapshot } from "../events/transcript.js";
import {
  listInboxObjectBodies,
  loadPersistedEvents,
  loadPersistedRun,
  loadSessionFiles,
  persistRunRecord,
  persistSessionFiles,
  replacePersistedEvents,
  writeInboxObjectBody,
  type PersistedRun,
} from "../store/persist.js";
import { mergeStoredRun, queueFromRecord, slimRunDocument } from "../store/run-record.js";
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

function localObjectKeyFromArtifact(runId: string, key: string): string {
  const marker = `runs/${runId}/`;
  const index = key.indexOf(marker);
  return index >= 0 ? key.slice(index) : key;
}

export async function archiveRunArtifacts(runId: string): Promise<void> {
  const store = getObjectStore();
  if (store.kind === "none") {
    return;
  }
  const events = loadPersistedEvents(runId);
  const record = loadPersistedRun(runId, undefined, { resolveImages: false });
  const session = loadSessionFiles(runId);
  const snapshot = buildTranscriptSnapshot(runId, events);
  await store.put(artifactKey(runId, "events.jsonl"), events.map((item) => JSON.stringify(item)).join("\n") + (events.length ? "\n" : ""));
  await store.put(artifactKey(runId, "snapshot.json"), `${JSON.stringify(snapshot)}\n`, "application/json");
  if (record) {
    await store.put(artifactKey(runId, "record.json"), `${JSON.stringify(slimRunDocument(record))}\n`, "application/json");
    await store.put(artifactKey(runId, "queue.json"), `${JSON.stringify(queueFromRecord(record))}\n`, "application/json");
  }
  for (const item of listInboxObjectBodies(runId)) {
    const suffix = item.key.startsWith(`runs/${runId}/`) ? item.key.slice(`runs/${runId}/`.length) : item.key;
    await store.put(artifactKey(runId, suffix), item.body);
  }
  await store.put(artifactKey(runId, "session-manifest.json"), `${JSON.stringify(session.map((file) => file.name))}\n`, "application/json");
  for (const file of session) {
    await store.put(artifactKey(runId, `session/${file.name}`), file.content);
  }
}

export async function loadArchivedArtifacts(runId: string): Promise<{
  record: PersistedRun | null;
  events: RunEvent[];
  session: Array<{ name: string; content: string }>;
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
  const queueRaw = await store.get(artifactKey(runId, "queue.json"));
  for (const key of await store.list(artifactKey(runId, "inbox/"))) {
    const body = await store.get(key);
    if (body != null) {
      writeInboxObjectBody(localObjectKeyFromArtifact(runId, key), body);
    }
  }
  const record = recordRaw ? mergeStoredRun(JSON.parse(recordRaw), queueRaw ? JSON.parse(queueRaw) : undefined) : null;
  const manifestRaw = await store.get(artifactKey(runId, "session-manifest.json"));
  const names = manifestRaw ? (JSON.parse(manifestRaw) as string[]) : [];
  const session: Array<{ name: string; content: string }> = [];
  for (const name of names) {
    const content = await store.get(artifactKey(runId, `session/${name}`));
    if (typeof content === "string") {
      session.push({ name, content });
    }
  }
  return { record, events, session };
}

export async function restoreArchivedArtifacts(runId: string): Promise<{
  record: PersistedRun | null;
  events: RunEvent[];
} | null> {
  const loaded = await loadArchivedArtifacts(runId);
  if (!loaded) {
    return null;
  }
  if (loaded.record) {
    const current = loadPersistedRun(runId);
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
