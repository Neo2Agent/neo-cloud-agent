import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { StartTurnRequest, TurnSignalRequest } from "@neo-cloud-agent/contracts";
import { WebSocketServer } from "ws";
import { presentedToken, tokenMatches } from "./auth.js";
import { createControlPlane } from "./cloud.js";
import { ToolsHub } from "./hub.js";
import { inferChat, runTurn, type TurnControl } from "./turn.js";

type ActiveTurn = TurnControl & {
  abort: () => void;
  pushSteer: (text: string) => void;
};

export type LoopServer = {
  http: Server;
  hub: ToolsHub;
  close: () => Promise<void>;
};

export function createLoopServer(options: { token?: string } = {}): LoopServer {
  const token = options.token ?? process.env.NEO_LOOP_TOKEN ?? "";
  const hub = new ToolsHub();
  const turns = new Map<string, ActiveTurn>();
  const sockets = new WebSocketServer({ noServer: true });

  const http = createServer(async (req, res) => {
    try {
      await handleHttp(req, res, { token, hub, turns });
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      send(res, 500, { error: message });
    }
  });

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://loop.local");
    const match = /^\/internal\/tools\/([^/]+)$/.exec(url.pathname);
    if (!match?.[1]) {
      rejectUpgrade(socket, 404, "not_found");
      return;
    }
    if (!tokenMatches(token, presentedToken(req, url))) {
      rejectUpgrade(socket, 401, "unauthorized");
      return;
    }
    const runId = decodeURIComponent(match[1]);
    sockets.handleUpgrade(req, socket, head, (ws) => {
      hub.attach(runId, ws);
    });
  });

  return {
    http,
    hub,
    close: () =>
      new Promise((resolve, reject) => {
        for (const turn of turns.values()) {
          turn.abort();
        }
        sockets.close();
        http.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { token: string; hub: ToolsHub; turns: Map<string, ActiveTurn> },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://loop.local");
  const method = req.method ?? "GET";
  if (method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true, service: "neo-loop", runtime: "node" });
    return;
  }
  if (!tokenMatches(ctx.token, presentedToken(req, url))) {
    send(res, 401, { error: "invalid neo-loop token" });
    return;
  }
  if (method === "POST" && url.pathname === "/internal/loop/turns") {
    const body = (await readJson(req)) as StartTurnRequest;
    if (!body?.runId || !body.turnId) {
      send(res, 400, { error: "runId and turnId are required" });
      return;
    }
    const control = startControl();
    ctx.turns.set(body.turnId, control);
    void runTurn({
      request: body,
      cloud: createControlPlane(body.controlPlaneUrl, body.jwt),
      hub: ctx.hub,
      infer: inferChat,
      control,
    }).finally(() => {
      ctx.turns.delete(body.turnId);
    });
    send(res, 202, { turnId: body.turnId, runId: body.runId, accepted: true });
    return;
  }
  const signalMatch = /^\/internal\/loop\/turns\/([^/]+)\/signal$/.exec(url.pathname);
  if (method === "POST" && signalMatch?.[1]) {
    const turnId = decodeURIComponent(signalMatch[1]);
    const body = (await readJson(req)) as TurnSignalRequest;
    const turn = ctx.turns.get(turnId);
    if (turn && body?.type === "abort") {
      turn.abort();
    } else if (turn && body?.type === "steer" && body.text) {
      turn.pushSteer(body.text);
    }
    send(res, 202, { turnId, runId: "", accepted: true });
    return;
  }
  send(res, 404, { error: "not_found" });
}

function startControl(): ActiveTurn {
  const controller = new AbortController();
  const steered: string[] = [];
  let aborted = false;
  return {
    signal: controller.signal,
    aborted: () => aborted,
    takeSteer: () => steered.shift(),
    abort: () => {
      aborted = true;
      controller.abort();
    },
    pushSteer: (text) => {
      steered.push(text);
    },
  };
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

export function listen(server: LoopServer, port: number, host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve) => {
    server.http.listen(port, host, () => {
      const address = server.http.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}
