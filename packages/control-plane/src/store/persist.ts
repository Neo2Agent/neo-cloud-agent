import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  FollowUp,
  ImageRef,
  Run,
  RunEvent,
  RunSubscription,
  RuntimeKind,
  TranscriptSnapshot,
  WorkerInbound,
} from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";

export type ActiveTurn = {
  type: "prompt" | "steer" | "follow_up";
  text: string;
  images?: ImageRef[];
};

export type PersistedRun = {
  version: 1;
  run: Run;
  followUps: FollowUp[];
  inbound: WorkerInbound[];
  subscriptions?: RunSubscription[];
  /** Last user turn the worker took but has not finished with agent.end. */
  activeTurn?: ActiveTurn | null;
};

export function controlStateDir(runsDir = getConfig().runsDir): string {
  return path.join(runsDir, ".control");
}

function runFile(runId: string, runsDir?: string): string {
  return path.join(controlStateDir(runsDir), `${runId}.json`);
}

function eventsFile(runId: string, runsDir?: string): string {
  return path.join(controlStateDir(runsDir), `${runId}.events.jsonl`);
}

function transcriptFile(runId: string, runsDir?: string): string {
  return path.join(controlStateDir(runsDir), `${runId}.transcript.json`);
}

function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

export type PersistHooks = {
  onRun?: (record: PersistedRun) => void;
  onEvent?: (event: RunEvent) => void;
  onLease?: (lease: WorkerLease) => void;
  onDeleteLease?: (runId: string) => void;
};

let persistHooks: PersistHooks = {};

export function setPersistHooks(hooks: PersistHooks): void {
  persistHooks = hooks;
}

export type PersistOptions = {
  /** When false, skip the remote/Postgres mirror. Used while hydrating from Postgres. */
  mirror?: boolean;
};

export function persistRunRecord(record: PersistedRun, runsDir?: string, options?: PersistOptions): void {
  writeJsonAtomic(runFile(record.run.id, runsDir), { ...record, version: 1 });
  if (options?.mirror !== false) {
    persistHooks.onRun?.(record);
  }
}

export function persistTranscriptSnapshot(snapshot: TranscriptSnapshot, runsDir?: string): void {
  writeJsonAtomic(transcriptFile(snapshot.runId, runsDir), snapshot);
}

export function loadTranscriptSnapshot(runId: string, runsDir?: string): TranscriptSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(transcriptFile(runId, runsDir), "utf8")) as TranscriptSnapshot;
    if (!parsed || parsed.runId !== runId || !Array.isArray(parsed.messages)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Cheap tail read so a compiled snapshot can skip parsing the full JSONL. */
export function peekLastPersistedEventId(runId: string, runsDir?: string): string | null {
  const file = eventsFile(runId, runsDir);
  try {
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      if (size === 0) {
        return null;
      }
      const length = Math.min(size, 8192);
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, size - length);
      const lines = buf.toString("utf8").split("\n").filter((line) => line.trim());
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const event = JSON.parse(lines[index] ?? "") as { id?: unknown };
          if (typeof event.id === "string" && event.id) {
            return event.id;
          }
        } catch {
          // first line may be a torn prefix when the window starts mid-record
        }
      }
      return null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function persistEvent(event: RunEvent, runsDir?: string, options?: PersistOptions): void {
  const file = eventsFile(event.runId, runsDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(event)}\n`, { flag: "a" });
  if (options?.mirror !== false) {
    persistHooks.onEvent?.(event);
  }
}

export function loadPersistedEvents(runId: string, runsDir?: string): RunEvent[] {
  const file = eventsFile(runId, runsDir);
  try {
    const lines = readFileSync(file, "utf8").split("\n");
    const events: RunEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as RunEvent);
      } catch {
        // skip a torn JSONL line from a crashed write
      }
    }
    return events;
  } catch {
    return [];
  }
}

function sessionDir(runId: string, runsDir?: string): string {
  return path.join(controlStateDir(runsDir), `${runId}.session`);
}

const SKIP_SESSION_NAMES = new Set(["auth.json", "models.json"]);

export function safeSessionPath(root: string, name: string): string | null {
  const relative = name.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative || relative.includes("..")) {
    return null;
  }
  const base = path.basename(relative);
  if (SKIP_SESSION_NAMES.has(base)) {
    return null;
  }
  if (!base.endsWith(".jsonl") && !base.endsWith(".json")) {
    return null;
  }
  const dest = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (dest !== resolvedRoot && !dest.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return dest;
}

function walkSessionFiles(dir: string, prefix = ""): Array<{ name: string; bytes: number }> {
  const out: Array<{ name: string; bytes: number }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSessionFiles(full, rel));
      continue;
    }
    if (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json")) {
      out.push({ name: rel, bytes: statSync(full).size });
    }
  }
  return out;
}

export function persistSessionFiles(
  runId: string,
  files: Array<{ name: string; content: string }>,
  runsDir?: string,
): Array<{ name: string; bytes: number }> {
  const dir = sessionDir(runId, runsDir);
  mkdirSync(dir, { recursive: true });
  const written: Array<{ name: string; bytes: number }> = [];
  for (const file of files) {
    const dest = safeSessionPath(dir, file.name);
    if (!dest) {
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    const content = file.content.slice(0, 1_000_000);
    writeFileSync(dest, content);
    written.push({
      name: path.relative(dir, dest).replaceAll(path.sep, "/"),
      bytes: Buffer.byteLength(content),
    });
  }
  return written;
}

export function listSessionFiles(runId: string, runsDir?: string): Array<{ name: string; bytes: number }> {
  const dir = sessionDir(runId, runsDir);
  try {
    return walkSessionFiles(dir);
  } catch {
    return [];
  }
}

export function loadSessionFiles(runId: string, runsDir?: string): Array<{ name: string; content: string }> {
  const dir = sessionDir(runId, runsDir);
  try {
    return walkSessionFiles(dir).map((file) => ({
      name: file.name,
      content: readFileSync(path.join(dir, ...file.name.split("/")), "utf8"),
    }));
  } catch {
    return [];
  }
}

export function restoreSessionToDir(runId: string, destDir: string, runsDir?: string): Array<{ name: string; bytes: number }> {
  mkdirSync(destDir, { recursive: true });
  const restored: Array<{ name: string; bytes: number }> = [];
  for (const file of loadSessionFiles(runId, runsDir)) {
    const dest = safeSessionPath(destDir, file.name);
    if (!dest) {
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
    restored.push({ name: file.name, bytes: Buffer.byteLength(file.content) });
  }
  return restored;
}

export function loadPersistedRun(runId: string, runsDir?: string): PersistedRun | null {
  try {
    return JSON.parse(readFileSync(runFile(runId, runsDir), "utf8")) as PersistedRun;
  } catch {
    return null;
  }
}

export function replacePersistedEvents(runId: string, events: RunEvent[], runsDir?: string): void {
  const file = eventsFile(runId, runsDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const body = events.length === 0 ? "" : `${events.map((item) => JSON.stringify(item)).join("\n")}\n`;
  writeFileSync(file, body);
}

export function loadPersistedRuns(runsDir = getConfig().runsDir): PersistedRun[] {
  const dir = controlStateDir(runsDir);
  try {
    return readdirSync(dir)
      .filter(
        (name) =>
          name.endsWith(".json") &&
          !name.endsWith(".tmp") &&
          !name.endsWith(".worker.json") &&
          !name.endsWith(".transcript.json"),
      )
      .map((name) => {
        try {
          return JSON.parse(readFileSync(path.join(dir, name), "utf8")) as PersistedRun;
        } catch {
          return null;
        }
      })
      .filter((item): item is PersistedRun => Boolean(item?.run?.id));
  } catch {
    return [];
  }
}

export type WorkerLease = {
  runId: string;
  runtime: RuntimeKind;
  handleId: string;
  pid?: number | null;
  container?: string | null;
  socket?: string | null;
  cid?: number | null;
  updatedAt: string;
};

function workerFile(runId: string, runsDir?: string): string {
  return path.join(controlStateDir(runsDir), `${runId}.worker.json`);
}

export function persistWorkerLease(lease: WorkerLease, runsDir?: string, options?: PersistOptions): void {
  writeJsonAtomic(workerFile(lease.runId, runsDir), lease);
  if (options?.mirror !== false) {
    persistHooks.onLease?.(lease);
  }
}

export function loadWorkerLease(runId: string, runsDir?: string): WorkerLease | null {
  try {
    return JSON.parse(readFileSync(workerFile(runId, runsDir), "utf8")) as WorkerLease;
  } catch {
    return null;
  }
}

export function deleteWorkerLease(runId: string, runsDir?: string, options?: PersistOptions): void {
  try {
    rmSync(workerFile(runId, runsDir), { force: true });
  } catch {
    // ignore
  }
  if (options?.mirror !== false) {
    persistHooks.onDeleteLease?.(runId);
  }
}
