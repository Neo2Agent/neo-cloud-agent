import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAccountStore } from "../accounts/store.js";
import { userMemoryEnabled, type UserRecord } from "../accounts/types.js";
import { snapshotForRun } from "../events/snapshot.js";
import { listRuns } from "../orchestrator/orchestrator.js";
import { controlStateDir } from "../store/persist.js";
import { readMem0Info } from "./client.js";
import { extractUserMemories } from "./extract.js";

const MEMORY_EXTRACT_TIME_ZONE = "Asia/Shanghai";
export const MEMORY_EXTRACT_HOUR = 2;
export const MEMORY_EXTRACT_SPREAD_MS = 4 * 60 * 60 * 1000;
export const MEMORY_EXTRACT_USER_CONCURRENCY = 2;
export const MEMORY_EXTRACT_RUNS_PER_USER = 8;
/** setTimeout argument cap; tomorrow 02:00 is far below this. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Shanghai is UTC+8 with no DST; used only to turn a local wall time into epoch. */
const SHANGHAI_OFFSET_HOURS = 8;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export type DailyExtractRun = {
  id: string;
  userId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type StampMap = Record<string, string>;
type ExtractMessage = { role?: string; text?: string; createdAt?: string };

let sweepInFlight = false;
let beforeWorkForTests: (() => Promise<void>) | null = null;

export function setDailyExtractBeforeWorkForTests(fn: (() => Promise<void>) | null): void {
  beforeWorkForTests = fn;
}

export function isDailyExtractRunning(): boolean {
  return sweepInFlight;
}

export function resetDailyExtractForTests(): void {
  sweepInFlight = false;
  beforeWorkForTests = null;
}

export function shanghaiDate(now: Date | number | string): string {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = shanghaiParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addCalendarDays(yyyyMmDd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!match) {
    return "";
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function shanghaiTargetDate(now: Date): string {
  return addCalendarDays(shanghaiDate(now), -1);
}

export function shanghaiDateAtHour(yyyyMmDd: string, hour: number): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!match) {
    return Number.NaN;
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour - SHANGHAI_OFFSET_HOURS, 0, 0);
}

function fnv1a32(text: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function userExtractOffsetMs(userId: string): number {
  return fnv1a32(userId) % MEMORY_EXTRACT_SPREAD_MS;
}

export function isUserExtractDue(input: {
  userId: string;
  now: Date;
  lastTargetDate?: string;
}): boolean {
  const today = shanghaiDate(input.now);
  const targetDate = addCalendarDays(today, -1);
  if (!today || !targetDate || input.lastTargetDate === targetDate) {
    return false;
  }
  const windowStart = shanghaiDateAtHour(today, MEMORY_EXTRACT_HOUR);
  return input.now.getTime() >= windowStart + userExtractOffsetMs(input.userId);
}

function userNextExtractAtMs(input: {
  userId: string;
  now: Date;
  lastTargetDate?: string;
}): number {
  const today = shanghaiDate(input.now);
  const yesterday = addCalendarDays(today, -1);
  const tomorrow = addCalendarDays(today, 1);
  const offsetMs = userExtractOffsetMs(input.userId);
  if (input.lastTargetDate === yesterday) {
    return shanghaiDateAtHour(tomorrow, MEMORY_EXTRACT_HOUR) + offsetMs;
  }
  const todaySlot = shanghaiDateAtHour(today, MEMORY_EXTRACT_HOUR) + offsetMs;
  return input.now.getTime() >= todaySlot ? input.now.getTime() : todaySlot;
}

function nextOpenAtMs(now: Date): number {
  const today = shanghaiDate(now);
  const todayOpen = shanghaiDateAtHour(today, MEMORY_EXTRACT_HOUR);
  if (now.getTime() < todayOpen) {
    return todayOpen;
  }
  return shanghaiDateAtHour(addCalendarDays(today, 1), MEMORY_EXTRACT_HOUR);
}

export function nextDailyExtractDelayMs(input: {
  now: Date;
  userIds: string[];
  stamps?: Record<string, string>;
}): number {
  const stamps = input.stamps ?? {};
  let wakeAt = input.userIds.length === 0 ? nextOpenAtMs(input.now) : Number.POSITIVE_INFINITY;
  for (const userId of input.userIds) {
    wakeAt = Math.min(wakeAt, userNextExtractAtMs({ userId, now: input.now, lastTargetDate: stamps[userId] }));
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(0, wakeAt - input.now.getTime()));
}

async function delayUntilNextExtract(now = new Date()): Promise<number> {
  if (!readMem0Info().configured) {
    return nextDailyExtractDelayMs({ now, userIds: [] });
  }
  const userIds = (await getAccountStore().listUsers()).filter((user) => userMemoryEnabled(user)).map((user) => user.id);
  return nextDailyExtractDelayMs({ now, userIds, stamps: readDailyExtractStamps() });
}

export function startDailyExtractLoop(): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const arm = (delayMs: number) => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      void runThenArm();
    }, delayMs);
    timer.unref();
  };

  const runThenArm = async () => {
    if (stopped) {
      return;
    }
    try {
      await sweepDailyExtracts();
    } catch (error) {
      console.error("memory daily extract failed", error);
    }
    if (stopped) {
      return;
    }
    try {
      arm(await delayUntilNextExtract());
    } catch (error) {
      console.error("memory daily extract schedule failed", error);
      arm(nextDailyExtractDelayMs({ now: new Date(), userIds: [] }));
    }
  };

  void delayUntilNextExtract()
    .then((delayMs) => arm(delayMs))
    .catch((error) => {
      console.error("memory daily extract schedule failed", error);
      arm(nextDailyExtractDelayMs({ now: new Date(), userIds: [] }));
    });

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Coarse gate only. A run still talking today keeps an updatedAt on today,
 * so equality with the target date would drop yesterday's slice.
 */
export function runMayContainShanghaiDate(run: DailyExtractRun, targetDate: string): boolean {
  const dayStart = shanghaiDateAtHour(targetDate, 0);
  const nextDayStart = shanghaiDateAtHour(addCalendarDays(targetDate, 1), 0);
  if (!Number.isFinite(dayStart) || !Number.isFinite(nextDayStart)) {
    return false;
  }
  const updatedAt = Date.parse(run.updatedAt ?? "");
  if (!Number.isFinite(updatedAt) || updatedAt < dayStart) {
    return false;
  }
  const createdAt = Date.parse(run.createdAt ?? "");
  if (Number.isFinite(createdAt) && createdAt >= nextDayStart) {
    return false;
  }
  return true;
}

export function selectMessagesOnShanghaiDate(messages: ExtractMessage[], targetDate: string): ExtractMessage[] {
  return messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      Boolean(message.text?.trim()) &&
      shanghaiDate(message.createdAt ?? "") === targetDate,
  );
}

export function selectRunsForDailyExtract(
  runs: DailyExtractRun[],
  userId: string,
  targetDate: string,
): DailyExtractRun[] {
  return runs
    .filter((run) => run.userId === userId && runMayContainShanghaiDate(run, targetDate))
    .sort((left, right) => {
      const delta = Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
      return delta !== 0 ? delta : left.id.localeCompare(right.id);
    })
    .slice(0, MEMORY_EXTRACT_RUNS_PER_USER);
}

function stampFile(): string {
  return path.join(controlStateDir(), "memory-daily-extract.json");
}

export function readDailyExtractStamps(): StampMap {
  try {
    const parsed = JSON.parse(readFileSync(stampFile(), "utf8")) as StampMap;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDailyExtractStamps(stamps: StampMap): void {
  const file = stampFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(stamps)}\n`);
  renameSync(tmp, file);
}

function markUserExtracted(userId: string, targetDate: string): void {
  writeDailyExtractStamps({ ...readDailyExtractStamps(), [userId]: targetDate });
}

function shanghaiParts(date: Date): { year: string; month: string; day: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: MEMORY_EXTRACT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: parts.year ?? "",
    month: parts.month ?? "",
    day: parts.day ?? "",
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

async function extractOneUser(user: UserRecord, targetDate: string): Promise<number> {
  const runs = selectRunsForDailyExtract(listRuns(), user.id, targetDate);
  const messages = [...runs]
    .reverse()
    .flatMap((run) => selectMessagesOnShanghaiDate(snapshotForRun(run.id).messages, targetDate));
  if (messages.length === 0) {
    markUserExtracted(user.id, targetDate);
    return 0;
  }
  const saved = await extractUserMemories({ userId: user.id, messages });
  markUserExtracted(user.id, targetDate);
  return saved.length;
}

export async function sweepDailyExtracts(now = new Date()): Promise<number> {
  if (sweepInFlight) {
    return 0;
  }
  if (!readMem0Info().configured) {
    return 0;
  }
  sweepInFlight = true;
  try {
    if (beforeWorkForTests) {
      await beforeWorkForTests();
    }
    const targetDate = shanghaiTargetDate(now);
    if (!targetDate) {
      return 0;
    }
    const stamps = readDailyExtractStamps();
    const due = (await getAccountStore().listUsers())
      .filter((user) => userMemoryEnabled(user) && isUserExtractDue({ userId: user.id, now, lastTargetDate: stamps[user.id] }))
      .sort((left, right) => {
        const delta = userExtractOffsetMs(left.id) - userExtractOffsetMs(right.id);
        return delta !== 0 ? delta : left.id.localeCompare(right.id);
      })
      .slice(0, MEMORY_EXTRACT_USER_CONCURRENCY);
    const results = await Promise.all(
      due.map(async (user) => {
        try {
          return await extractOneUser(user, targetDate);
        } catch (error) {
          const message = error instanceof Error ? error.message : "extract_failed";
          console.warn(`memory daily extract skipped user=${user.id} ${message}`);
          return 0;
        }
      }),
    );
    return results.reduce((sum, count) => sum + count, 0);
  } finally {
    sweepInFlight = false;
  }
}
