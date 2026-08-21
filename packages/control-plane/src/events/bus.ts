import { EventEmitter } from "node:events";
import { redactRunEvent, type RunEvent } from "@neo-cloud-agent/contracts";
import { controlPlaneSecrets } from "../security/secrets.js";
import { persistEvent } from "../store/persist.js";

const bus = new EventEmitter();
bus.setMaxListeners(0);

const history = new Map<string, RunEvent[]>();

export function publish(event: RunEvent, options?: { persist?: boolean }): void {
  const clean = redactRunEvent(event, controlPlaneSecrets());
  const list = history.get(event.runId) ?? [];
  list.push(clean);
  history.set(event.runId, list);
  if (options?.persist !== false) {
    persistEvent(clean);
  }
  bus.emit(event.runId, clean);
  bus.emit("*", clean);
}

export function seedEvents(runId: string, events: RunEvent[]): void {
  history.set(runId, [...events]);
}

export function resetHistory(): void {
  history.clear();
}

export function listEvents(runId: string): RunEvent[] {
  return history.get(runId) ?? [];
}

export function subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
  bus.on(runId, listener);
  return () => bus.off(runId, listener);
}
