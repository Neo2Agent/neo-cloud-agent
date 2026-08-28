import type { Run, RunEvent } from "@neo-cloud-agent/contracts";

const COLD_STATUSES = new Set<Run["status"]>(["ARCHIVED", "EXPIRED"]);

export function keepHotHistory(status: Run["status"] | undefined): boolean {
  if (!status) {
    return false;
  }
  return !COLD_STATUSES.has(status);
}

/** Collapse consecutive token deltas so RAM does not keep every token. Persist still has the full log. */
export function compactHotEvents(events: RunEvent[]): RunEvent[] {
  if (events.length < 2) {
    return events.slice();
  }
  const out: RunEvent[] = [];
  for (const event of events) {
    const prev = out.at(-1);
    if (event.kind === "message.delta" && prev?.kind === "message.delta") {
      out[out.length - 1] = {
        ...prev,
        id: event.id,
        seq: event.seq ?? prev.seq,
        createdAt: event.createdAt,
        data: {
          ...prev.data,
          ...event.data,
          delta: `${String(prev.data?.delta ?? "")}${String(event.data?.delta ?? "")}`,
        },
      };
      continue;
    }
    out.push(event);
  }
  return out;
}

const FOLD_AFTER = new Set(["message.end", "agent.end", "run.idle", "run.error"]);

/** Fold consecutive deltas only after the turn yields, not on context.usage mid-stream. */
export function compactClosedDeltaRuns(list: RunEvent[]): void {
  const last = list.at(-1);
  if (!last || !FOLD_AFTER.has(last.kind)) {
    return;
  }
  let end = list.length - 2;
  if (end < 1 || list[end]?.kind !== "message.delta") {
    return;
  }
  let start = end;
  while (start > 0 && list[start - 1]?.kind === "message.delta") {
    start -= 1;
  }
  if (start === end) {
    return;
  }
  const deltas = list.slice(start, end + 1);
  const lastDelta = deltas.at(-1);
  if (!lastDelta) {
    return;
  }
  list.splice(start, deltas.length, {
    ...lastDelta,
    data: {
      ...lastDelta.data,
      delta: deltas.map((item) => String(item.data?.delta ?? "")).join(""),
    },
  });
}
