import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { isDeskTarget, SECRET_ENV_KEYS, type ExecutionTarget } from "@neo-cloud-agent/contracts";
import { SSE_HEADERS } from "../events/stream.js";

export const MAX_TERMS_PER_RUN = 4;
export const TERM_BUFFER_CHARS = 60_000;

const IDLE_MS = 30 * 60 * 1000;
const DEAD_KEEP_MS = 2 * 60 * 1000;

export type WorkspaceTermEvent =
  | { type: "ready"; id: string; cwd: string; shell: string }
  | { type: "data"; chunk: string }
  | { type: "exit"; code: number | null };

export type WorkspaceTermInfo = {
  id: string;
  cwd: string;
  shell: string;
  alive: boolean;
};

export class WorkspaceTermError extends Error {
  constructor(
    readonly code: "too_many" | "not_found" | "dead",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceTermError";
  }
}

type Session = {
  id: string;
  runId: string;
  cwd: string;
  shell: string;
  child: ChildProcess;
  alive: boolean;
  exitCode: number | null;
  buffer: string;
  lastWriteAt: number;
  listeners: Set<(event: WorkspaceTermEvent) => void>;
};

const sessions = new Map<string, Session>();

export function workspaceTermDeniedReason(target?: ExecutionTarget | null): string | null {
  if (isDeskTarget(target)) {
    return "本机对话请在 Desk 右侧栏用终端。网页打不开那台电脑上的 shell。";
  }
  return null;
}

export function workspaceTermStatus(error: WorkspaceTermError): number {
  if (error.code === "not_found") {
    return 404;
  }
  return 409;
}

export function workspaceShellLaunch(): { command: string; args: string[]; name: string } {
  const candidates = [
    { command: "/bin/zsh", name: "zsh" },
    { command: "/usr/bin/zsh", name: "zsh" },
    { command: "/bin/bash", name: "bash" },
    { command: "/usr/bin/bash", name: "bash" },
  ];
  for (const item of candidates) {
    if (existsSync(item.command)) {
      return { ...item, args: ["-i"] };
    }
  }
  return { command: "/bin/sh", args: ["-i"], name: "sh" };
}

export function workspaceTermEnv(cwd: string, shell: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: cwd,
    PWD: cwd,
    TERM: "dumb",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || process.env.LANG || "C.UTF-8",
    SHELL: shell,
    USER: process.env.USER || "neo",
    LOGNAME: process.env.LOGNAME || process.env.USER || "neo",
    PS1: "\\W $ ",
    PROMPT: "%~ %# ",
    HISTFILE: "/dev/null",
  };
  for (const key of SECRET_ENV_KEYS) {
    delete env[key];
  }
  delete env.DEEPSEEK_API_KEY;
  delete env.OPENAI_API_KEY;
  return env;
}

function emit(session: Session, event: WorkspaceTermEvent): void {
  if (event.type === "data") {
    session.buffer = `${session.buffer}${event.chunk}`.slice(-TERM_BUFFER_CHARS);
  }
  for (const listener of session.listeners) {
    listener(event);
  }
}

function sessionInfo(session: Session): WorkspaceTermInfo {
  return { id: session.id, cwd: session.cwd, shell: session.shell, alive: session.alive };
}

export function listWorkspaceTerms(runId: string): WorkspaceTermInfo[] {
  return [...sessions.values()].filter((item) => item.runId === runId && item.alive).map(sessionInfo);
}

export function onWorkspaceTermEvent(
  id: string,
  listener: (event: WorkspaceTermEvent) => void,
): () => void {
  const session = sessions.get(id);
  if (!session) {
    throw new WorkspaceTermError("not_found", "终端不存在");
  }
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

function requireSession(runId: string, id: string): Session {
  const session = sessions.get(id);
  if (!session || session.runId !== runId) {
    throw new WorkspaceTermError("not_found", "终端不存在");
  }
  return session;
}

export function openWorkspaceTerm(input: { runId: string; cwd: string }): WorkspaceTermInfo {
  const alive = listWorkspaceTerms(input.runId).length;
  if (alive >= MAX_TERMS_PER_RUN) {
    throw new WorkspaceTermError("too_many", `每个对话最多开 ${MAX_TERMS_PER_RUN} 个终端`);
  }
  mkdirSync(input.cwd, { recursive: true });
  const launch = workspaceShellLaunch();
  const id = `term_${randomBytes(4).toString("hex")}`;
  const env = workspaceTermEnv(input.cwd, launch.command);
  const child = spawn(launch.command, launch.args, {
    cwd: input.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const session: Session = {
    id,
    runId: input.runId,
    cwd: path.resolve(input.cwd),
    shell: launch.name,
    child,
    alive: true,
    exitCode: null,
    buffer: `${launch.name} · ${path.resolve(input.cwd)}\n`,
    lastWriteAt: Date.now(),
    listeners: new Set(),
  };
  const stdoutDec = new StringDecoder("utf8");
  const stderrDec = new StringDecoder("utf8");
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = stdoutDec.write(chunk);
    if (text) {
      emit(session, { type: "data", chunk: text });
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = stderrDec.write(chunk);
    if (text) {
      emit(session, { type: "data", chunk: text });
    }
  });
  child.on("exit", (code) => {
    session.alive = false;
    session.exitCode = code;
    emit(session, { type: "exit", code });
  });
  child.on("error", (error) => {
    emit(session, { type: "data", chunk: `${error instanceof Error ? error.message : String(error)}\n` });
    session.alive = false;
    session.exitCode = 1;
    emit(session, { type: "exit", code: 1 });
  });
  sessions.set(id, session);
  return sessionInfo(session);
}

export function writeWorkspaceTerm(runId: string, id: string, data: string): void {
  const session = requireSession(runId, id);
  if (!session.alive) {
    throw new WorkspaceTermError("dead", "终端已经结束");
  }
  session.lastWriteAt = Date.now();
  session.child.stdin?.write(data);
}

export function closeWorkspaceTerm(runId: string, id: string): boolean {
  const session = sessions.get(id);
  if (!session || session.runId !== runId) {
    return false;
  }
  session.child.kill("SIGTERM");
  sessions.delete(id);
  return true;
}

export function closeWorkspaceTermsForRun(runId: string): void {
  for (const session of [...sessions.values()]) {
    if (session.runId === runId) {
      closeWorkspaceTerm(runId, session.id);
    }
  }
}

export function attachWorkspaceTermStream(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  id: string,
): void {
  const session = requireSession(runId, id);
  res.writeHead(200, SSE_HEADERS);
  const write = (event: WorkspaceTermEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  write({ type: "ready", id: session.id, cwd: session.cwd, shell: session.shell });
  if (session.buffer) {
    write({ type: "data", chunk: session.buffer });
  }
  if (!session.alive) {
    write({ type: "exit", code: session.exitCode });
  }
  const onEvent = (event: WorkspaceTermEvent) => write(event);
  session.listeners.add(onEvent);
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);
  ping.unref();
  req.on("close", () => {
    session.listeners.delete(onEvent);
    clearInterval(ping);
  });
}

export function resetWorkspaceShellsForTests(): void {
  for (const session of [...sessions.values()]) {
    session.child.kill("SIGTERM");
  }
  sessions.clear();
}

const reaper = setInterval(() => {
  const now = Date.now();
  for (const session of [...sessions.values()]) {
    if (session.alive && now - session.lastWriteAt > IDLE_MS) {
      session.child.kill("SIGTERM");
      continue;
    }
    if (!session.alive && now - session.lastWriteAt > DEAD_KEEP_MS) {
      sessions.delete(session.id);
    }
  }
}, 60_000);
reaper.unref();
