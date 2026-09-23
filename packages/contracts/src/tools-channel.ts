/** Versioned frames on the loop ↔ tools WebSocket. */

export const TOOLS_CHANNEL_VERSION = 1 as const;

export type ToolsChannelRole = "tools" | "loop";

export type ToolsChannelFrame =
  | ToolsHelloFrame
  | ToolsExecFrame
  | ToolsExecStdoutFrame
  | ToolsExecStderrFrame
  | ToolsExecEndFrame
  | ToolsFsUploadFrame
  | ToolsFsDownloadFrame
  | ToolsFsListFrame
  | ToolsFsExistsFrame
  | ToolsOkFrame
  | ToolsErrFrame
  | ToolsAbortFrame
  | ToolsAbortAllFrame
  | ToolsPingFrame
  | ToolsPongFrame;

interface ToolsFrameBase {
  v: typeof TOOLS_CHANNEL_VERSION;
}

interface ToolsHelloFrame extends ToolsFrameBase {
  type: "hello";
  runId: string;
  role: ToolsChannelRole;
  sandboxRoot: string;
}

interface ToolsExecFrame extends ToolsFrameBase {
  type: "exec";
  callId: string;
  command: string;
  timeoutMs: number;
  cwd?: string;
}

interface ToolsExecStdoutFrame extends ToolsFrameBase {
  type: "exec.stdout";
  callId: string;
  seq: number;
  text: string;
}

interface ToolsExecStderrFrame extends ToolsFrameBase {
  type: "exec.stderr";
  callId: string;
  seq: number;
  text: string;
}

interface ToolsExecEndFrame extends ToolsFrameBase {
  type: "exec.end";
  callId: string;
  exitCode: number;
}

interface ToolsFsUploadFrame extends ToolsFrameBase {
  type: "fs.upload";
  callId: string;
  path: string;
  bytesB64: string;
}

interface ToolsFsDownloadFrame extends ToolsFrameBase {
  type: "fs.download";
  callId: string;
  path: string;
}

interface ToolsFsListFrame extends ToolsFrameBase {
  type: "fs.list";
  callId: string;
  path: string;
}

interface ToolsFsExistsFrame extends ToolsFrameBase {
  type: "fs.exists";
  callId: string;
  path: string;
}

export interface ToolsOkFrame extends ToolsFrameBase {
  type: "ok";
  callId: string;
  path?: string;
  bytesB64?: string;
  names?: string[];
  exists?: boolean;
}

export interface ToolsErrFrame extends ToolsFrameBase {
  type: "err";
  callId: string;
  code: "not_found" | "escaped" | "protected" | "timeout" | "denied" | "bad_frame" | "internal";
  message: string;
}

interface ToolsAbortFrame extends ToolsFrameBase {
  type: "abort";
  callId: string;
}

interface ToolsAbortAllFrame extends ToolsFrameBase {
  type: "abort_all";
}

interface ToolsPingFrame extends ToolsFrameBase {
  type: "ping";
}

interface ToolsPongFrame extends ToolsFrameBase {
  type: "pong";
  diskUsedBytes?: number;
}

export function isToolsChannelFrame(value: unknown): value is ToolsChannelFrame {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.v === TOOLS_CHANNEL_VERSION && typeof record.type === "string";
}
