import type { IncomingMessage, ServerResponse } from "node:http";
import { SSE_HEADERS } from "./stream.js";
import { subscribeUserList } from "./user-bus.js";

/** Live-only: list mutations are ephemeral, so there is nothing useful to replay. */
export function attachUserListStream(req: IncomingMessage, res: ServerResponse, userId: string): void {
  res.writeHead(200, SSE_HEADERS);
  res.write(": connected\n\n");
  const unsubscribe = subscribeUserList(userId, (event) => {
    res.write(`id: ${event.id}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);
  ping.unref();
  req.on("close", () => {
    unsubscribe();
    clearInterval(ping);
  });
}
