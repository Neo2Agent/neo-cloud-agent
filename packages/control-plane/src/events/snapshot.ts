import {
  buildTranscriptSnapshot,
  transcriptHasUnsettledWork,
  type TranscriptSnapshot,
} from "@neo-cloud-agent/contracts";
import { listEvents } from "./bus.js";
import {
  loadPersistedEvents,
  loadTranscriptSnapshot,
  peekLastPersistedEventId,
  persistTranscriptSnapshot,
} from "../store/persist.js";
import { compactHotEvents } from "./history.js";

function withPageMeta(snapshot: TranscriptSnapshot): TranscriptSnapshot {
  return {
    ...snapshot,
    remaining: snapshot.remaining ?? 0,
    nextBefore: snapshot.nextBefore ?? null,
    total: snapshot.total ?? snapshot.messages.length,
  };
}

/** Prefer RAM, then a compiled snapshot whose cursor matches disk, else rebuild. */
export function snapshotForRun(runId: string): TranscriptSnapshot {
  const hot = listEvents(runId);
  if (hot.length > 0) {
    return buildTranscriptSnapshot(runId, hot);
  }
  const lastId = peekLastPersistedEventId(runId);
  const cached = loadTranscriptSnapshot(runId);
  if (cached && cached.lastEventId === lastId && !transcriptHasUnsettledWork(cached.messages)) {
    return withPageMeta(cached);
  }
  const events = compactHotEvents(loadPersistedEvents(runId));
  const snapshot = buildTranscriptSnapshot(runId, events);
  persistTranscriptSnapshot(snapshot);
  return snapshot;
}
