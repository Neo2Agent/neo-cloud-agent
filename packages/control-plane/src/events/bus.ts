import { EventEmitter } from "node:events";
import { buildTranscriptSnapshot, redactRunEvent, type RunEvent } from "@neo-cloud-agent/contracts";
import { scheduleArchive } from "../objects/archive.js";
import { controlPlaneSecrets } from "../security/secrets.js";
import { loadPersistedEvents, persistEvent, persistTranscriptSnapshot } from "../store/persist.js";
import { compactClosedDeltaRuns, compactHotEvents } from "./history.js";

function rememberTranscript(runId: string, events: RunEvent[]): void {
  persistTranscriptSnapshot(buildTranscriptSnapshot(runId, events));
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

const history = new Map<string, RunEvent[]>();

export type HotPublisher = {
  publish(event: RunEvent): void;
};

let hot: HotPublisher | null = null;

export function attachHotBus(next: HotPublisher | null): void {
  hot = next;
}

export function ingestRemoteEvent(event: RunEvent): boolean {
  const list = history.get(event.runId) ?? [];
  if (list.some((item) => item.id === event.id)) {
    return false;
  }
  const seq = event.seq ?? (list.at(-1)?.seq ?? 0) + 1;
  const clean = { ...event, seq };
  list.push(clean);
  compactClosedDeltaRuns(list);
  history.set(event.runId, list);
  if (clean.kind !== "message.delta") {
    rememberTranscript(event.runId, list);
  }
  bus.emit(event.runId, clean);
  bus.emit("*", clean);
  return true;
}

export function publish(event: RunEvent, options?: { persist?: boolean }): void {
  const list = history.get(event.runId) ?? [];
  const seq = event.seq ?? (list.at(-1)?.seq ?? 0) + 1;
  const clean = { ...redactRunEvent(event, controlPlaneSecrets()), seq };
  list.push(clean);
  compactClosedDeltaRuns(list);
  history.set(event.runId, list);
  if (options?.persist !== false) {
    persistEvent(clean);
    scheduleArchive(event.runId);
    if (clean.kind !== "message.delta") {
      rememberTranscript(event.runId, list);
    }
  }
  bus.emit(event.runId, clean);
  bus.emit("*", clean);
  if (options?.persist !== false) {
    hot?.publish(clean);
  }
}

export function seedEvents(runId: string, events: RunEvent[]): void {
  history.set(
    runId,
    compactHotEvents(events.map((item, index) => ({ ...item, seq: item.seq ?? index + 1 }))),
  );
}

export function dropHistory(runId: string): void {
  history.delete(runId);
}

export function resetHistory(): void {
  history.clear();
}

export function listEvents(runId: string): RunEvent[] {
  return history.get(runId) ?? [];
}

/** Live RAM first; archived / evicted runs read the persisted log and collapse deltas. */
export function eventsForRun(runId: string): RunEvent[] {
  const hot = history.get(runId);
  if (hot && hot.length > 0) {
    return hot;
  }
  return compactHotEvents(loadPersistedEvents(runId));
}

export function listEventsAfter(runId: string, after?: string | null): RunEvent[] {
  const all = eventsForRun(runId);
  if (!after) {
    return all;
  }
  const index = all.findIndex((item) => item.id === after || String(item.seq) === after);
  // A compacted delta id is gone from RAM. Replaying the whole log appends the
  // story again and Chrome dies (error 5) on the next EventSource reconnect.
  return index === -1 ? [] : all.slice(index + 1);
}

export function subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
  bus.on(runId, listener);
  return () => bus.off(runId, listener);
}
