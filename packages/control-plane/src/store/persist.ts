import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FollowUp, Run, RunEvent, WorkerInbound } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";

export type PersistedRun = {
  version: 1;
  run: Run;
  followUps: FollowUp[];
  inbound: WorkerInbound[];
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

function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

export function persistRunRecord(record: PersistedRun, runsDir?: string): void {
  writeJsonAtomic(runFile(record.run.id, runsDir), { ...record, version: 1 });
}

export function persistEvent(event: RunEvent, runsDir?: string): void {
  const file = eventsFile(event.runId, runsDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(event)}\n`, { flag: "a" });
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

export function persistSessionFiles(
  runId: string,
  files: Array<{ name: string; content: string }>,
  runsDir?: string,
): Array<{ name: string; bytes: number }> {
  const dir = sessionDir(runId, runsDir);
  mkdirSync(dir, { recursive: true });
  const written: Array<{ name: string; bytes: number }> = [];
  for (const file of files) {
    const name = path.basename(file.name);
    if (!name || name.includes("..") || file.name.includes("..")) {
      continue;
    }
    if (!name.endsWith(".jsonl") && !name.endsWith(".json")) {
      continue;
    }
    const content = file.content.slice(0, 1_000_000);
    const dest = path.join(dir, name);
    writeFileSync(dest, content);
    written.push({ name, bytes: Buffer.byteLength(content) });
  }
  return written;
}

export function listSessionFiles(runId: string, runsDir?: string): Array<{ name: string; bytes: number }> {
  const dir = sessionDir(runId, runsDir);
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl") || name.endsWith(".json"))
      .map((name) => ({
        name,
        bytes: Buffer.byteLength(readFileSync(path.join(dir, name))),
      }));
  } catch {
    return [];
  }
}

export function loadPersistedRuns(runsDir = getConfig().runsDir): PersistedRun[] {
  const dir = controlStateDir(runsDir);
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.endsWith(".tmp"))
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
