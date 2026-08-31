import type { RunEvent } from "@neo-cloud-agent/contracts";
import { buildTranscriptSnapshot } from "../events/transcript.js";
import {
  loadPersistedEvents,
  loadPersistedRun,
  loadSessionFiles,
  persistRunRecord,
  persistSessionFiles,
  replacePersistedEvents,
  type PersistedRun,
} from "../store/persist.js";
import { artifactKey, getObjectStore } from "./store.js";

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function cancelArchive(runId: string): void {
  const previous = timers.get(runId);
  if (previous) {
    clearTimeout(previous);
    timers.delete(runId);
  }
}

export function scheduleArchive(runId: string): void {
  if (getObjectStore().kind === "none") {
    return;
  }
  cancelArchive(runId);
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
  const record = loadPersistedRun(runId);
  const session = loadSessionFiles(runId);
  const snapshot = buildTranscriptSnapshot(runId, events);
  await store.put(artifactKey(runId, "events.jsonl"), events.map((item) => JSON.stringify(item)).join("\n") + (events.length ? "\n" : ""));
  await store.put(artifactKey(runId, "snapshot.json"), `${JSON.stringify(snapshot)}\n`, "application/json");
  if (record) {
    await store.put(artifactKey(runId, "record.json"), `${JSON.stringify(record)}\n`, "application/json");
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
  const record = recordRaw ? (JSON.parse(recordRaw) as PersistedRun) : null;
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
  const current = loadPersistedRun(runId);
  if (current?.run?.deletedAt) {
    return { record: current, events: loadPersistedEvents(runId) };
  }
  const loaded = await loadArchivedArtifacts(runId);
  if (!loaded) {
    return null;
  }
  if (loaded.record?.run?.deletedAt) {
    persistRunRecord(loaded.record);
    return { record: loaded.record, events: loaded.events };
  }
  if (loaded.record) {
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
