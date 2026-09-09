import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { verifyRunToken } from "@neo-cloud-agent/contracts";
import type { Run } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { findDeskByToken, hasInbox } from "../desks/store.js";
import { getRun, isDeskRunClaimed } from "../orchestrator/orchestrator.js";
import { readBearer } from "../security/auth.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_IN_FLIGHT = 8;
const inFlight = new Map<string, number>();

export function websocketAcceptKey(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

export function parseDeskToolsUpgradePath(pathname: string): { deskId: string; runId: string } | undefined {
  const match = /^\/v1\/desks\/([^/]+)\/tools\/([^/]+)$/.exec(pathname);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { deskId: decodeURIComponent(match[1]), runId: decodeURIComponent(match[2]) };
}

export function evaluateDeskToolsProxy(input: {
  deskId: string;
  runId: string;
  deskOnline: boolean;
  deskMatches: boolean;
  run?: Pick<Run, "id" | "kernel" | "executionTarget">;
  claimed: boolean;
  runJwtOk: boolean;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!input.deskMatches) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (!input.deskOnline) {
    return { ok: false, status: 409, error: "desk_offline" };
  }
  const run = input.run;
  if (!run) {
    return { ok: false, status: 404, error: "run_not_found" };
  }
  if ((run.kernel ?? "pi") !== "agentscope") {
    return { ok: false, status: 400, error: "kernel_not_agentscope" };
  }
  if (run.executionTarget?.loop !== "cloud" || run.executionTarget.tools !== "desk") {
    return { ok: false, status: 400, error: "not_cloud_loop_desk_tools" };
  }
  if (run.executionTarget.deskId !== input.deskId) {
    return { ok: false, status: 403, error: "desk_mismatch" };
  }
  if (!input.claimed) {
    return { ok: false, status: 409, error: "not_claimed" };
  }
  if (!input.runJwtOk) {
    return { ok: false, status: 401, error: "invalid_run_jwt" };
  }
  const current = inFlight.get(input.runId) ?? 0;
  if (current >= MAX_IN_FLIGHT) {
    return { ok: false, status: 429, error: "too_many_tools_streams" };
  }
  return { ok: true };
}

function runJwtFromUpgrade(req: IncomingMessage, url: URL): string {
  const header = req.headers["x-neo-run-jwt"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return (fromHeader || url.searchParams.get("jwt") || "").trim();
}

function verifyRunJwt(token: string, runId: string): boolean {
  if (!token) {
    return false;
  }
  try {
    return verifyRunToken(getConfig().jwtSecret, token).runId === runId;
  } catch {
    return false;
  }
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function noteOpen(runId: string): void {
  inFlight.set(runId, (inFlight.get(runId) ?? 0) + 1);
}

function noteClose(runId: string): void {
  const next = (inFlight.get(runId) ?? 1) - 1;
  if (next <= 0) {
    inFlight.delete(runId);
  } else {
    inFlight.set(runId, next);
  }
}

function loopToolsUrl(runId: string): URL {
  const base = getConfig().neoLoopUrl.replace(/\/$/, "");
  const url = new URL(`${base}/internal/tools/${encodeURIComponent(runId)}`);
  const token = getConfig().neoLoopToken;
  if (token) {
    url.searchParams.set("token", token);
  }
  return url;
}

export function handleDeskToolsUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url ?? "/", "http://control-plane.local");
  const parsed = parseDeskToolsUpgradePath(url.pathname);
  if (!parsed) {
    reject(socket, 404, "Not Found");
    return;
  }
  const deskToken = readBearer(req) || url.searchParams.get("token") || "";
  const desk = deskToken ? findDeskByToken(deskToken) : undefined;
  const run = getRun(parsed.runId);
  const runJwt = runJwtFromUpgrade(req, url);
  const decision = evaluateDeskToolsProxy({
    deskId: parsed.deskId,
    runId: parsed.runId,
    deskOnline: Boolean(desk && hasInbox(desk.id)),
    deskMatches: Boolean(desk && desk.id === parsed.deskId),
    run,
    claimed: isDeskRunClaimed(parsed.runId),
    runJwtOk: verifyRunJwt(runJwt, parsed.runId),
  });
  if (!decision.ok) {
    reject(socket, decision.status, decision.error);
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || !key) {
    reject(socket, 400, "missing_websocket_key");
    return;
  }

  noteOpen(parsed.runId);
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    noteClose(parsed.runId);
  };

  const target = loopToolsUrl(parsed.runId);
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = transport({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method: "GET",
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": req.headers["sec-websocket-version"] ?? "13",
      "sec-websocket-key": key,
      ...(getConfig().neoLoopToken ? { authorization: `Bearer ${getConfig().neoLoopToken}` } : {}),
    },
  });
  upstream.on("upgrade", (_upRes, loopSocket, loopHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAcceptKey(key)}\r\n\r\n`,
    );
    if (head.length) {
      loopSocket.write(head);
    }
    if (loopHead.length) {
      socket.write(loopHead);
    }
    socket.on("close", release);
    loopSocket.on("close", release);
    socket.on("error", () => loopSocket.destroy());
    loopSocket.on("error", () => socket.destroy());
    socket.pipe(loopSocket);
    loopSocket.pipe(socket);
  });
  upstream.on("error", () => {
    release();
    reject(socket, 502, "loop_unreachable");
  });
  upstream.on("response", (response) => {
    release();
    reject(socket, response.statusCode ?? 502, "loop_rejected");
  });
  upstream.end();
}

export function resetDeskToolsInFlight(): void {
  inFlight.clear();
}
