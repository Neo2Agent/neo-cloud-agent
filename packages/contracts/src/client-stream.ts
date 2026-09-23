import type { RunEvent } from "./events.js";

export type TurnSignal = "work" | "idle" | "fail";

const TURN_WORK_KINDS = new Set([
  "agent.start",
  "user.message",
  "followup.delivered",
  "tool.start",
  "tool.update",
  "tool.end",
  "message.start",
  "message.delta",
]);

/** One SSE `data:` payload. Anything without an id and kind is a keep-alive or garbage. */
export function parseSseData(raw: string): RunEvent | null {
  try {
    const event = JSON.parse(raw) as RunEvent;
    return event?.id && event.kind ? event : null;
  } catch {
    return null;
  }
}

function mergeDelta(previous: RunEvent, incoming: RunEvent): RunEvent {
  return {
    ...incoming,
    data: {
      ...previous.data,
      ...incoming.data,
      delta: `${String(previous.data?.delta ?? "")}${String(incoming.data?.delta ?? "")}`,
    },
  };
}

/** Append live SSE events without keeping every token as its own array row. Replays by id are dropped. */
export function applyLiveEvents(prev: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  if (incoming.length === 0) {
    return prev;
  }
  let next = prev;
  const seen = new Set(prev.map((item) => item.id));
  for (const event of incoming) {
    if (!event?.id || seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    if (next === prev) {
      next = prev.slice();
    }
    const last = next.at(-1);
    if (event.kind === "message.delta" && last?.kind === "message.delta") {
      next[next.length - 1] = mergeDelta(last, event);
      continue;
    }
    next.push(event);
  }
  return next;
}

/** Last turn signal in a live batch. `run.idle` after tools still means the turn may be done. */
export function batchTurnSignal(events: Array<{ kind: string }>): TurnSignal | null {
  let signal: TurnSignal | null = null;
  for (const event of events) {
    if (event.kind === "run.error" || event.kind === "run.archived" || event.kind === "run.deleted") {
      signal = "fail";
    } else if (event.kind === "run.idle") {
      signal = "idle";
    } else if (TURN_WORK_KINDS.has(event.kind)) {
      signal = "work";
    }
  }
  return signal;
}

/** Query for `GET /v1/runs/:id/events`. `after` must be the transcript snapshot cursor. */
export function runEventsQuery(
  opts: { after?: string | null; accessToken?: string | null; client?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (opts.after) params.set("after", opts.after);
  if (opts.accessToken) params.set("access_token", opts.accessToken);
  if (opts.client) params.set("client", opts.client);
  const query = params.toString();
  return query ? `?${query}` : "";
}
