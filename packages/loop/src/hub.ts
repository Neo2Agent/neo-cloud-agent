import { TOOLS_CHANNEL_VERSION, isToolsChannelFrame, type ToolsChannelFrame } from "@neo-cloud-agent/contracts";
import { WebSocket } from "ws";

export type ToolCallResult = {
  ok: boolean;
  text: string;
  stdout: string;
};

type Pending = {
  resolve: (result: ToolCallResult) => void;
  stdout: string[];
  timer: NodeJS.Timeout;
};

type Connection = {
  socket: WebSocket;
  sandboxRoot: string;
  ready: Promise<void>;
  markReady: () => void;
  pending: Map<string, Pending>;
};

const CALL_TIMEOUT_MS = 60_000;

export class ToolsHub {
  private readonly connections = new Map<string, Connection>();

  attach(runId: string, socket: WebSocket): void {
    this.detach(runId);
    let markReady = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const connection: Connection = { socket, sandboxRoot: "", ready, markReady, pending: new Map() };
    this.connections.set(runId, connection);
    socket.on("message", (data) => {
      this.onFrame(runId, parseFrame(data));
    });
    socket.on("close", () => {
      if (this.connections.get(runId)?.socket === socket) {
        this.failPending(runId, "tools connection closed");
        this.connections.delete(runId);
      }
    });
  }

  detach(runId: string): void {
    const current = this.connections.get(runId);
    if (!current) {
      return;
    }
    this.failPending(runId, "tools connection replaced");
    this.connections.delete(runId);
    current.socket.close();
  }

  sandboxRoot(runId: string): string {
    return this.connections.get(runId)?.sandboxRoot ?? "";
  }

  async waitReady(runId: string, timeoutMs = 15_000): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const connection = this.connections.get(runId);
      if (connection) {
        await Promise.race([
          connection.ready,
          new Promise((resolve) => setTimeout(resolve, 50)),
        ]);
        if (connection.sandboxRoot) {
          return connection.sandboxRoot;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("tools worker not connected");
  }

  call(runId: string, frame: ToolsChannelFrame, timeoutMs = CALL_TIMEOUT_MS): Promise<ToolCallResult> {
    const connection = this.connections.get(runId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, text: "tools worker not connected", stdout: "" });
    }
    const callId = "callId" in frame ? frame.callId : "";
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        connection.pending.delete(callId);
        resolve({ ok: false, text: `tool timed out after ${timeoutMs}ms`, stdout: "" });
      }, timeoutMs);
      connection.pending.set(callId, { resolve, stdout: [], timer });
      connection.socket.send(JSON.stringify(frame));
    });
  }

  abortAll(runId: string): void {
    const connection = this.connections.get(runId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const frame: ToolsChannelFrame = { v: TOOLS_CHANNEL_VERSION, type: "abort_all" };
    connection.socket.send(JSON.stringify(frame));
  }

  private onFrame(runId: string, frame: ToolsChannelFrame | undefined): void {
    if (!frame) {
      return;
    }
    const connection = this.connections.get(runId);
    if (!connection) {
      return;
    }
    if (frame.type === "hello" && frame.role === "tools") {
      connection.sandboxRoot = frame.sandboxRoot;
      connection.markReady();
      return;
    }
    if (!("callId" in frame)) {
      return;
    }
    const pending = connection.pending.get(frame.callId);
    if (!pending) {
      return;
    }
    if (frame.type === "exec.stdout" || frame.type === "exec.stderr") {
      pending.stdout.push(frame.text);
      return;
    }
    if (frame.type === "exec.end") {
      connection.pending.delete(frame.callId);
      clearTimeout(pending.timer);
      const stdout = pending.stdout.join("");
      pending.resolve({
        ok: frame.exitCode === 0,
        text: stdout || `exit ${frame.exitCode}`,
        stdout,
      });
      return;
    }
    if (frame.type === "ok") {
      connection.pending.delete(frame.callId);
      clearTimeout(pending.timer);
      pending.resolve({ ok: true, text: okText(frame), stdout: "" });
      return;
    }
    if (frame.type === "err") {
      connection.pending.delete(frame.callId);
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, text: frame.message, stdout: "" });
    }
  }

  private failPending(runId: string, message: string): void {
    const connection = this.connections.get(runId);
    if (!connection) {
      return;
    }
    for (const [callId, pending] of connection.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, text: message, stdout: "" });
      connection.pending.delete(callId);
    }
  }
}

function parseFrame(data: unknown): ToolsChannelFrame | undefined {
  const raw = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  try {
    const parsed: unknown = JSON.parse(raw);
    return isToolsChannelFrame(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function okText(frame: Extract<ToolsChannelFrame, { type: "ok" }>): string {
  if (typeof frame.bytesB64 === "string") {
    return Buffer.from(frame.bytesB64, "base64").toString("utf8");
  }
  if (frame.names) {
    return frame.names.join("\n");
  }
  if (typeof frame.exists === "boolean") {
    return frame.exists ? "exists" : "missing";
  }
  return frame.path ?? "ok";
}
