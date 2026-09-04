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
import {
  getObjectSync,
  listObjectsSync,
  putObjectSync,
  removeObjectSync,
  removePrefixSync,
} from "../objects/fs.js";
import { getConfig } from "../config.js";
import {
  collectObjectKeys,
  inboxImageKey,
  inboxPrefix,
  isObjectImageRef,
  isOwnedInboxKey,
  mapRecordImages,
  mergeStoredRun,
  objectImageData,
  parseObjectImageKey,
  publicFollowUps,
  queueFromRecord,
  RECORD_VERSION_FAT,
  RECORD_VERSION_SLIM,
  slimRunDocument,
  stripDeliveredImages,
  type RunQueueDocument,
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

function isRunControlFile(name: string): boolean {
  return (
    name.endsWith(".json") &&
    !name.endsWith(".tmp") &&
    !name.endsWith(".worker.json") &&
    !name.endsWith(".transcript.json") &&
    !name.endsWith(".queue.json")
  );
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
  onDeleteQueue?: (runId: string) => void;
};

let persistHooks: PersistHooks = {};

export function setPersistHooks(hooks: PersistHooks): void {
  persistHooks = hooks;
}

export type PersistOptions = {
  /** When false, skip the remote/Postgres mirror. Used while hydrating from Postgres. */
  mirror?: boolean;
};

/** Clone, offload queued images, strip delivered images, then GC unreferenced inbox keys. */
export function persistImagesForRecord(record: PersistedRun, runsDir?: string): PersistedRun {
  const dir = runsDir ?? getConfig().runsDir;
  const stripped = stripDeliveredImages(structuredClone(record));
  const stored = mapRecordImages(stripped, (images, ownerId, kind) =>
    persistImages(images, record.run.id, ownerId, kind, dir),
  );
  reclaimUnreferencedInbox(record.run.id, collectObjectKeys(stored), dir);
  return stored;
}

function persistImages(
  images: ImageRef[] | undefined,
  runId: string,
  ownerId: string,
  kind: string,
  runsDir: string,
): ImageRef[] | undefined {
  if (!images?.length) {
    return undefined;
  }
  const next: ImageRef[] = [];
  for (const [index, image] of images.entries()) {
    if (isObjectImageRef(image.data)) {
      const key = parseObjectImageKey(image.data);
      if (key && isOwnedInboxKey(runId, key)) {
        next.push(image);
      }
      continue;
    }
    const key = inboxImageKey(runId, `${kind}-${ownerId}-${index + 1}`);
    putObjectSync(runsDir, key, image.data);
    next.push({ mediaType: image.mediaType, data: objectImageData(key) });
  }
  return next.length > 0 ? next : undefined;
}

export function resolvePersistedRun(record: PersistedRun, runsDir?: string): PersistedRun {
  const dir = runsDir ?? getConfig().runsDir;
  return mapRecordImages(record, (images) => resolveImages(images, record.run.id, dir));
}

export function resolveImages(
  images: ImageRef[] | undefined,
  runId: string,
  runsDir?: string,
): ImageRef[] | undefined {
  if (!images?.length) {
    return images;
  }
  const dir = runsDir ?? getConfig().runsDir;
  const resolved: ImageRef[] = [];
  for (const image of images) {
    const key = parseObjectImageKey(image.data);
    if (!key) {
      resolved.push(image);
      continue;
    }
    if (!isOwnedInboxKey(runId, key)) {
      continue;
    }
    const body = getObjectSync(dir, key);
    if (body == null) {
      continue;
    }
    resolved.push({ mediaType: image.mediaType, data: body });
  }
  return resolved;
}

export function persistRunRecord(record: PersistedRun, runsDir?: string, options?: PersistOptions): void {
  const stored = persistImagesForRecord(record, runsDir);
  writeJsonAtomic(queueFile(stored.run.id, runsDir), queueFromRecord(stored));
  writeJsonAtomic(runFile(stored.run.id, runsDir), slimRunDocument(stored));
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

export function loadPersistedQueue(runId: string, runsDir?: string): RunQueueDocument | null {
  try {
    const parsed = JSON.parse(readFileSync(queueFile(runId, runsDir), "utf8")) as RunQueueDocument;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
      inbound: Array.isArray(parsed.inbound) ? parsed.inbound : [],
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      activeTurn: parsed.activeTurn ?? null,
    };
  } catch {
    return null;
  }
}

export function loadPersistedRunDocument(runId: string, runsDir?: string): PersistedRun | null {
  try {
    const parsed = JSON.parse(readFileSync(runFile(runId, runsDir), "utf8")) as PersistedRun;
    return parsed?.run?.id ? parsed : null;
  } catch {
    return null;
  }
}

function mergeDiskRun(runId: string, runsDir?: string): PersistedRun | null {
  const document = loadPersistedRunDocument(runId, runsDir);
  if (!document) {
    return null;
  }
  const queue = loadPersistedQueue(runId, runsDir);
  return mergeStoredRun(document, queue, queue ? RECORD_VERSION_SLIM : RECORD_VERSION_FAT);
}

export function loadPersistedRunRaw(runId: string, runsDir?: string): PersistedRun | null {
  return mergeDiskRun(runId, runsDir);
}

export function loadPersistedRun(runId: string, runsDir?: string): PersistedRun | null {
  const merged = mergeDiskRun(runId, runsDir);
  return merged ? resolvePersistedRun(merged, runsDir) : null;
}

export function publicFollowUpsForRun(runId: string, items: FollowUp[], runsDir?: string): FollowUp[] {
  return publicFollowUps(items, (images) => resolveImages(images, runId, runsDir));
}

export function listInboxObjectKeys(runId: string, runsDir?: string): string[] {
  return listObjectsSync(runsDir ?? getConfig().runsDir, inboxPrefix(runId));
}

export function readInboxObject(key: string, runsDir?: string): string | null {
  return getObjectSync(runsDir ?? getConfig().runsDir, key);
}

export function writeInboxObject(key: string, body: string, runsDir?: string): void {
  putObjectSync(runsDir ?? getConfig().runsDir, key, body);
}

export function reclaimPersistedRun(runId: string, runsDir?: string): void {
  const dir = runsDir ?? getConfig().runsDir;
  try {
    rmSync(queueFile(runId, dir), { force: true });
  } catch {
    // ignore
  }
  removePrefixSync(dir, inboxPrefix(runId));
  try {
    rmSync(path.join(dir, ".objects", "runs", runId, "inbox"), { recursive: true, force: true });
  } catch {
    // ignore
  }
  persistHooks.onDeleteQueue?.(runId);
}

function reclaimUnreferencedInbox(runId: string, kept: Set<string>, runsDir: string): void {
  for (const key of listObjectsSync(runsDir, inboxPrefix(runId))) {
    if (!kept.has(key)) {
      removeObjectSync(runsDir, key);
    }
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
      .filter(isRunControlFile)
      .map((name) => loadPersistedRun(name.slice(0, -".json".length), runsDir))
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
