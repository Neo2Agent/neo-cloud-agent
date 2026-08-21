import { EventEmitter } from "node:events";
import { redactRunEvent, type RunEvent } from "@neo-cloud-agent/contracts";
import { scheduleArchive } from "../objects/archive.js";
import { controlPlaneSecrets } from "../security/secrets.js";
import { persistEvent } from "../store/persist.js";

const bus = new EventEmitter();
bus.setMaxListeners(0);

const history = new Map<string, RunEvent[]>();

export function publish(event: RunEvent, options?: { persist?: boolean }): void {
  const list = history.get(event.runId) ?? [];
  const seq = event.seq ?? (list.at(-1)?.seq ?? 0) + 1;
  const clean = { ...redactRunEvent(event, controlPlaneSecrets()), seq };
  list.push(clean);
  history.set(event.runId, list);
  if (options?.persist !== false) {
    persistEvent(clean);
    scheduleArchive(event.runId);
  }
  bus.emit(event.runId, clean);
  bus.emit("*", clean);
}

export function seedEvents(runId: string, events: RunEvent[]): void {
  history.set(
    runId,
    events.map((item, index) => ({ ...item, seq: item.seq ?? index + 1 })),
  );
}

export function resetHistory(): void {
  history.clear();
}

export function listEvents(runId: string): RunEvent[] {
  return history.get(runId) ?? [];
}

export function listEventsAfter(runId: string, after?: string | null): RunEvent[] {
  const all = listEvents(runId);
  if (!after) {
    return all;
  }
  const index = all.findIndex((item) => item.id === after || String(item.seq) === after);
  return index === -1 ? all : all.slice(index + 1);
}

export function subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
  bus.on(runId, listener);
  return () => bus.off(runId, listener);
}
