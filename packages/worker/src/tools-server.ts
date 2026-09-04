import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type {
  ToolsChannelFrame,
  ToolsErrFrame,
  ToolsOkFrame,
} from "@neo-cloud-agent/contracts";
import { TOOLS_CHANNEL_VERSION } from "@neo-cloud-agent/contracts";
import { assertExecCommand, assertReadablePath, assertWritablePath, ensureParentDir } from "./path-guard.js";

export type ToolsServerOptions = {
  runId: string;
  sandboxRoot: string;
  send: (frame: ToolsChannelFrame) => void;
};

type RunningExec = {
  child: ChildProcess;
  seq: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export class ToolsServer {
  private readonly running = new Map<string, RunningExec>();

  constructor(private readonly options: ToolsServerOptions) {}

  hello(): void {
    this.options.send({
      v: TOOLS_CHANNEL_VERSION,
      type: "hello",
      runId: this.options.runId,
      role: "tools",
      sandboxRoot: this.options.sandboxRoot,
    });
  }

  handle(frame: ToolsChannelFrame): void {
    switch (frame.type) {
      case "ping":
        this.options.send({ v: TOOLS_CHANNEL_VERSION, type: "pong", diskUsedBytes: 0 });
        return;
      case "abort":
        this.abort(frame.callId);
        return;
      case "abort_all":
        this.abortAll();
        return;
      case "exec":
        this.exec(frame.callId, frame.command, frame.timeoutMs, frame.cwd);
        return;
      case "fs.upload":
        this.upload(frame.callId, frame.path, frame.bytesB64);
        return;
      case "fs.download":
        this.download(frame.callId, frame.path);
        return;
      case "fs.list":
        this.list(frame.callId, frame.path);
        return;
      case "fs.exists":
        this.exists(frame.callId, frame.path);
        return;
      default:
        break;
    }
  }

  abort(callId: string): void {
    const running = this.running.get(callId);
    if (!running) {
      return;
    }
    running.child.kill("SIGTERM");
  }

  abortAll(): void {
    for (const callId of [...this.running.keys()]) {
      this.abort(callId);
    }
  }

  dispose(): void {
    this.abortAll();
  }

  private err(callId: string, code: ToolsErrFrame["code"], message: string): void {
    this.options.send({ v: TOOLS_CHANNEL_VERSION, type: "err", callId, code, message });
  }

  private ok(callId: string, extra: Omit<ToolsOkFrame, "v" | "type" | "callId"> = {}): void {
    this.options.send({ v: TOOLS_CHANNEL_VERSION, type: "ok", callId, ...extra });
  }

  private exec(callId: string, command: string, timeoutMs: number, cwd?: string): void {
    const blocked = assertExecCommand(this.options.sandboxRoot, command);
    if (blocked) {
      this.err(callId, blocked.code, blocked.message);
      return;
    }
    const workdir = cwd?.trim() ? cwd : this.options.sandboxRoot;
    const workdirCheck = assertReadablePath(this.options.sandboxRoot, workdir);
    if (typeof workdirCheck !== "string") {
      this.err(callId, workdirCheck.code, workdirCheck.message);
      return;
    }
    const child = spawn("bash", ["-lc", command], {
      cwd: workdirCheck,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: this.options.sandboxRoot },
    });
    const state: RunningExec = { child, seq: 0 };
    this.running.set(callId, state);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      this.err(callId, "timeout", `exec timed out after ${timeoutMs || DEFAULT_TIMEOUT_MS}ms`);
    }, timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
    child.stdout?.on("data", (chunk) => {
      state.seq += 1;
      this.options.send({
        v: TOOLS_CHANNEL_VERSION,
        type: "exec.stdout",
        callId,
        seq: state.seq,
        text: String(chunk),
      });
    });
    child.stderr?.on("data", (chunk) => {
      state.seq += 1;
      this.options.send({
        v: TOOLS_CHANNEL_VERSION,
        type: "exec.stderr",
        callId,
        seq: state.seq,
        text: String(chunk),
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      this.running.delete(callId);
      this.err(callId, "internal", error instanceof Error ? error.message : "exec failed");
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      this.running.delete(callId);
      this.options.send({
        v: TOOLS_CHANNEL_VERSION,
        type: "exec.end",
        callId,
        exitCode: code ?? 1,
      });
    });
  }

  private upload(callId: string, rawPath: string, bytesB64: string): void {
    const target = assertWritablePath(this.options.sandboxRoot, rawPath);
    if (typeof target !== "string") {
      this.err(callId, target.code, target.message);
      return;
    }
    try {
      ensureParentDir(target);
      writeFileSync(target, Buffer.from(bytesB64, "base64"));
      this.ok(callId, { path: rawPath });
    } catch (error) {
      this.err(callId, "internal", error instanceof Error ? error.message : "upload failed");
    }
  }

  private download(callId: string, rawPath: string): void {
    const target = assertReadablePath(this.options.sandboxRoot, rawPath);
    if (typeof target !== "string") {
      this.err(callId, target.code, target.message);
      return;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      this.err(callId, "not_found", `${rawPath} 不存在`);
      return;
    }
    try {
      this.ok(callId, { path: rawPath, bytesB64: readFileSync(target).toString("base64") });
    } catch (error) {
      this.err(callId, "internal", error instanceof Error ? error.message : "download failed");
    }
  }

  private list(callId: string, rawPath: string): void {
    const target = assertReadablePath(this.options.sandboxRoot, rawPath);
    if (typeof target !== "string") {
      this.err(callId, target.code, target.message);
      return;
    }
    if (!existsSync(target)) {
      this.err(callId, "not_found", `${rawPath} 不存在`);
      return;
    }
    try {
      const names = statSync(target).isDirectory() ? readdirSync(target) : [rawPath];
      this.ok(callId, { path: rawPath, names });
    } catch (error) {
      this.err(callId, "internal", error instanceof Error ? error.message : "list failed");
    }
  }

  private exists(callId: string, rawPath: string): void {
    const target = assertReadablePath(this.options.sandboxRoot, rawPath);
    if (typeof target !== "string") {
      this.err(callId, target.code, target.message);
      return;
    }
    this.ok(callId, { path: rawPath, exists: existsSync(target) });
  }
}
