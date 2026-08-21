import { EventEmitter } from "node:events";
import type { RunEvent } from "@neo-cloud-agent/contracts";

const bus = new EventEmitter();
bus.setMaxListeners(0);

const history = new Map<string, RunEvent[]>();

export function publish(event: RunEvent): void {
  const list = history.get(event.runId) ?? [];
  list.push(event);
  history.set(event.runId, list);
  bus.emit(event.runId, event);
  bus.emit("*", event);
}

export function listEvents(runId: string): RunEvent[] {
  return history.get(runId) ?? [];
}

export function subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
  bus.on(runId, listener);
  return () => bus.off(runId, listener);
}
