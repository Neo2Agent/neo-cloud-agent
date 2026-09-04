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
import {
  inboxImageObjectKey,
  inboxImageObjectKeyFromRef,
  inboxImageRefKey,
  isInboxImageKey,
  mapRecordImages,
  mergeStoredRun,
  queueFromRecord,
  slimRunDocument,
} from "./run-record.js";

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

function queueFile(runId: string, runsDir?: string): string {
  return path.join(controlStateDir(runsDir), `${runId}.queue.json`);
}

function objectRoot(runsDir?: string): string {
  return path.join(runsDir ?? getConfig().runsDir, ".objects");
}

function objectPath(key: string, runsDir?: string): string {
  const relative = key.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative || relative.includes("..")) {
    throw new Error(`invalid object key: ${key}`);
  }
  return path.join(objectRoot(runsDir), ...relative.split("/"));
}

function persistInboxImage(runId: string, image: ImageRef, name: string, runsDir?: string): ImageRef {
  if (isInboxImageKey(image.data) || !image.data.trim()) {
    return image;
  }
  const key = inboxImageObjectKey(runId, name);
  const dest = objectPath(key, runsDir);
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, image.data);
  renameSync(tmp, dest);
  return { mediaType: image.mediaType, data: inboxImageRefKey(runId, name) };
}

export function resolveInboxImage(image: ImageRef, runsDir?: string): ImageRef {
  const key = inboxImageObjectKeyFromRef(image.data);
  if (!key) {
    return image;
  }
  try {
    return { mediaType: image.mediaType, data: readFileSync(objectPath(key, runsDir), "utf8") };
  } catch {
    return image;
  }
}

export function resolveInboxImages(images: ImageRef[] | undefined, runsDir?: string): ImageRef[] | undefined {
  return images?.map((image) => resolveInboxImage(image, runsDir));
}

export function listInboxObjectBodies(runId: string, runsDir?: string): Array<{ key: string; body: string }> {
  const dir = path.join(objectRoot(runsDir), "runs", runId, "inbox");
  try {
    return readdirSync(dir)
      .filter((name) => !name.endsWith(".tmp"))
      .map((name) => ({
        key: inboxImageObjectKey(runId, name),
        body: readFileSync(path.join(dir, name), "utf8"),
      }));
  } catch {
    return [];
  }
}

export function writeInboxObjectBody(key: string, body: string, runsDir?: string): void {
  const dest = objectPath(key, runsDir);
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, dest);
}

export function persistableRecord(record: PersistedRun, runsDir?: string): PersistedRun {
  return mapRecordImages({ ...record, version: 1 }, (runId, image, name) => persistInboxImage(runId, image, name, runsDir));
}

function loadableRecord(record: PersistedRun, runsDir?: string): PersistedRun {
  return mapRecordImages(record, (_runId, image) => resolveInboxImage(image, runsDir));
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
  const stored = persistableRecord(record, runsDir);
  writeJsonAtomic(runFile(stored.run.id, runsDir), slimRunDocument(stored));
  writeJsonAtomic(queueFile(stored.run.id, runsDir), queueFromRecord(stored));
  if (options?.mirror !== false) {
    persistHooks.onRun?.(stored);
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

export function loadPersistedRun(
  runId: string,
  runsDir?: string,
  options?: { resolveImages?: boolean },
): PersistedRun | null {
  try {
    const document = JSON.parse(readFileSync(runFile(runId, runsDir), "utf8")) as unknown;
    let queue: unknown;
    try {
      queue = JSON.parse(readFileSync(queueFile(runId, runsDir), "utf8")) as unknown;
    } catch {
      queue = undefined;
    }
    const merged = mergeStoredRun(document, queue);
    if (!merged) {
      return null;
    }
    return options?.resolveImages === false ? merged : loadableRecord(merged, runsDir);
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
          !name.endsWith(".transcript.json") &&
          !name.endsWith(".queue.json"),
      )
      .map((name) => loadPersistedRun(name.replace(/\.json$/, ""), runsDir))
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
