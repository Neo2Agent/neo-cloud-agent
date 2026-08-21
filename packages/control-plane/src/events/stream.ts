import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunEvent } from "@neo-cloud-agent/contracts";
import { listEventsAfter, subscribe } from "./bus.js";

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
  "access-control-allow-origin": "*",
} as const;

export function writeSseEvent(res: ServerResponse, event: RunEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function resumeAfter(req: IncomingMessage, url: URL): string | null {
  const query = url.searchParams.get("after")?.trim();
  if (query) {
    return query;
  }
  const header = req.headers["last-event-id"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return null;
}

/** Subscribe first, then replay, so two clients never miss the same live delta. */
export function attachEventStream(req: IncomingMessage, res: ServerResponse, runId: string, url: URL): void {
  res.writeHead(200, SSE_HEADERS);
  const after = resumeAfter(req, url);
  const pending: RunEvent[] = [];
  let live = false;
  const unsubscribe = subscribe(runId, (item) => {
    if (!live) {
      pending.push(item);
      return;
    }
    writeSseEvent(res, item);
  });
  const history = listEventsAfter(runId, after);
  for (const item of history) {
    writeSseEvent(res, item);
  }
  live = true;
  const seen = new Set(history.map((item) => item.id));
  for (const item of pending) {
    if (!seen.has(item.id)) {
      writeSseEvent(res, item);
    }
  }
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);
  ping.unref();
  req.on("close", () => {
    unsubscribe();
    clearInterval(ping);
  });
}
