import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RedisHotClient } from "../events/redis.js";
import { controlStateDir } from "../store/persist.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type LoopSessionSql = {
  saveLoopSession(runId: string, userId: string, state: Record<string, unknown>): Promise<void>;
  loadLoopSession(runId: string): Promise<Record<string, unknown> | null>;
};

export type LoopSessionStoreKind = "file" | "redis" | "sql" | "redis+sql";

const sessions = new Map<string, Record<string, unknown>>();
let loaded = false;
let redis: RedisHotClient | null = null;
let sql: LoopSessionSql | null = null;

function filePath(): string {
  return path.join(controlStateDir(), "loop-sessions.json");
}

function redisKey(runId: string): string {
  return `loop:session:${runId}`;
}

function hydrate(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as Record<string, Record<string, unknown>>;
    for (const [runId, state] of Object.entries(parsed)) {
      if (state && typeof state === "object") {
        sessions.set(runId, state);
      }
    }
  } catch {
    // first boot
  }
}

function persistFile(): void {
  mkdirSync(path.dirname(filePath()), { recursive: true });
  writeFileSync(filePath(), JSON.stringify(Object.fromEntries(sessions), null, 2));
}

function parseState(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore corrupt cache
  }
  return undefined;
}

export function attachLoopSessionBackends(input: { redis?: RedisHotClient | null; sql?: LoopSessionSql | null }): void {
  redis = input.redis ?? null;
  sql = input.sql ?? null;
}

export function resetLoopSessionBackends(): void {
  redis = null;
  sql = null;
}

export function loopSessionStoreKind(): LoopSessionStoreKind {
  if (redis && sql) {
    return "redis+sql";
  }
  if (redis) {
    return "redis";
  }
  if (sql) {
    return "sql";
  }
  return "file";
}

export async function saveLoopSession(
  runId: string,
  state: Record<string, unknown>,
  opts: { userId?: string } = {},
): Promise<void> {
  hydrate();
  sessions.set(runId, state);
  persistFile();
  const payload = JSON.stringify(state);
  if (redis) {
    try {
      await redis.set(redisKey(runId), payload, SESSION_TTL_MS);
    } catch (error) {
      console.error("loop session redis save failed", error);
    }
  }
  if (sql) {
    try {
      await sql.saveLoopSession(runId, opts.userId ?? "", state);
    } catch (error) {
      console.error("loop session sql save failed", error);
    }
  }
}

export async function loadLoopSession(runId: string): Promise<Record<string, unknown> | undefined> {
  hydrate();
  const local = sessions.get(runId);
  if (local) {
    return local;
  }
  if (redis) {
    try {
      const fromRedis = parseState(await redis.get(redisKey(runId)));
      if (fromRedis) {
        sessions.set(runId, fromRedis);
        persistFile();
        return fromRedis;
      }
    } catch (error) {
      console.error("loop session redis load failed", error);
    }
  }
  if (sql) {
    try {
      const fromSql = await sql.loadLoopSession(runId);
      if (fromSql) {
        sessions.set(runId, fromSql);
        persistFile();
        return fromSql;
      }
    } catch (error) {
      console.error("loop session sql load failed", error);
    }
  }
  return undefined;
}

export function dropLoopSessionMemoryForTest(): void {
  sessions.clear();
}

export function resetLoopSessionsForTest(): void {
  sessions.clear();
  loaded = false;
  resetLoopSessionBackends();
}
