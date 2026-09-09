import { isDeskToolsProxyUrl, isToolsChannelFrame, type ToolsChannelFrame } from "@neo-cloud-agent/contracts";
import { ToolsServer } from "./tools-server.js";

export type ToolsWsOptions = {
  runId: string;
  jwt: string;
  loopUrl: string;
  sandboxRoot: string;
  token?: string;
};

function toWebSocketUrl(loopUrl: string): string {
  const base = loopUrl.replace(/\/$/, "");
  if (base.startsWith("https:")) {
    return `wss:${base.slice("https:".length)}`;
  }
  if (base.startsWith("http:")) {
    return `ws:${base.slice("http:".length)}`;
  }
  if (base.startsWith("ws")) {
    return base;
  }
  return `ws://${base}`;
}

export function toolsWsUrl(loopUrl: string, runId: string, extra: { jwt?: string; token?: string } = {}): string {
  const ws = toWebSocketUrl(loopUrl);
  const url = isDeskToolsProxyUrl(loopUrl)
    ? new URL(ws)
    : new URL(`${ws}/internal/tools/${encodeURIComponent(runId)}`);
  if (extra.jwt) {
    url.searchParams.set("jwt", extra.jwt);
  }
  if (extra.token) {
    url.searchParams.set("token", extra.token);
  }
  return url.toString();
}

export function connectToolsChannel(options: ToolsWsOptions): { close: () => void } {
  const url = toolsWsUrl(options.loopUrl, options.runId, { jwt: options.jwt, token: options.token });
  let socket: WebSocket | undefined;
  let closed = false;
  let server: ToolsServer | undefined;
  let retries = 0;

  const open = () => {
    if (closed) {
      return;
    }
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      retries = 0;
      server = new ToolsServer({
        runId: options.runId,
        sandboxRoot: options.sandboxRoot,
        send: (frame) => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(frame));
          }
        },
      });
      server.hello();
    });
    socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isToolsChannelFrame(parsed) || !server) {
        return;
      }
      server.handle(parsed);
    });
    socket.addEventListener("close", () => {
      server?.dispose();
      server = undefined;
      if (!closed && retries < 40) {
        retries += 1;
        setTimeout(open, Math.min(1000 * retries, 5000));
      }
    });
    socket.addEventListener("error", () => {
      socket?.close();
    });
  };

  open();
  return {
    close: () => {
      closed = true;
      server?.dispose();
      socket?.close();
    },
  };
}
