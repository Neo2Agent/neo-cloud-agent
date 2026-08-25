import type { RunEvent } from "@neo-cloud-agent/contracts/events";

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
