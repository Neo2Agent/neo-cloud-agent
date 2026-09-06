import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileAccountStore } from "../accounts/file.js";
import { setAccountStore } from "../accounts/store.js";
import {
  MEMORY_EXTRACT_HOUR,
  MEMORY_EXTRACT_SPREAD_MS,
  MEMORY_EXTRACT_TICK_MS,
  MEMORY_EXTRACT_USER_CONCURRENCY,
  addCalendarDays,
  isDailyExtractRunning,
  isUserExtractDue,
  readDailyExtractStamps,
  resetDailyExtractForTests,
  selectRunsForDailyExtract,
  setDailyExtractBeforeWorkForTests,
  shanghaiDate,
  shanghaiDateAtHour,
  shanghaiTargetDate,
  sweepDailyExtracts,
  userExtractOffsetMs,
} from "./daily-extract.js";
import { readMem0Info, setMem0FetchForTests } from "./client.js";

const SHANGHAI_SEPT7_0200 = new Date("2026-09-06T18:00:00.000Z");
const USER_ID = "user_daily";

test("daily extract ticks every minute after a 02:00 Shanghai start", () => {
  assert.equal(MEMORY_EXTRACT_TICK_MS, 60 * 1000);
  assert.equal(MEMORY_EXTRACT_HOUR, 2);
  assert.equal(MEMORY_EXTRACT_USER_CONCURRENCY, 2);
  assert.equal(shanghaiDate(SHANGHAI_SEPT7_0200), "2026-09-07");
  assert.equal(shanghaiTargetDate(SHANGHAI_SEPT7_0200), "2026-09-06");
  assert.equal(shanghaiDate("2026-09-06T15:59:59.000Z"), "2026-09-06");
  assert.equal(shanghaiDate("2026-09-06T16:00:00.000Z"), "2026-09-07");
  assert.equal(addCalendarDays("2026-09-01", -1), "2026-08-31");
});

test("user extract offset is stable and stays inside the four-hour spread", () => {
  const offset = userExtractOffsetMs(USER_ID);
  assert.equal(userExtractOffsetMs(USER_ID), offset);
  assert.ok(offset >= 0);
  assert.ok(offset < MEMORY_EXTRACT_SPREAD_MS);
  const other = userExtractOffsetMs("user_other");
  assert.notEqual(other, offset);
  assert.ok(other < MEMORY_EXTRACT_SPREAD_MS);
});

test("user is due only after 02:00 Shanghai plus the hashed offset", () => {
  const offset = userExtractOffsetMs(USER_ID);
  const windowStart = shanghaiDateAtHour("2026-09-07", MEMORY_EXTRACT_HOUR);
  const before = new Date(windowStart + offset - 1);
  const after = new Date(windowStart + offset);
  assert.equal(isUserExtractDue({ userId: USER_ID, now: before }), false);
  assert.equal(isUserExtractDue({ userId: USER_ID, now: after }), true);
  assert.equal(isUserExtractDue({ userId: USER_ID, now: after, lastTargetDate: "2026-09-06" }), false);
  assert.equal(isUserExtractDue({ userId: USER_ID, now: after, lastTargetDate: "2026-09-05" }), true);
});

test("daily extract picks the latest yesterday runs for one user", () => {
  const selected = selectRunsForDailyExtract(
    [
      { id: "old", userId: USER_ID, updatedAt: "2026-09-05T10:00:00.000Z" },
      { id: "mine", userId: USER_ID, updatedAt: "2026-09-06T08:00:00.000Z" },
      { id: "other", userId: "someone", updatedAt: "2026-09-06T09:00:00.000Z" },
      { id: "later", userId: USER_ID, updatedAt: "2026-09-06T12:00:00.000Z" },
    ],
    USER_ID,
    "2026-09-06",
  );
  assert.deepEqual(
    selected.map((run) => run.id),
    ["later", "mine"],
  );
});

async function withDailyExtractHarness(work: (now: Date) => Promise<void>): Promise<void> {
  const previousDir = process.env.RUNS_DIR;
  const previousUrl = process.env.MEM0_URL;
  const previousKey = process.env.MEM0_API_KEY;
  process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-mem-daily-"));
  process.env.MEM0_URL = "http://mem0.test";
  process.env.MEM0_API_KEY = "m0sk_test";
  const store = createFileAccountStore(process.env.RUNS_DIR);
  setAccountStore(store, "file");
  await store.createUser({
    id: USER_ID,
    email: "daily@example.com",
    passwordHash: "x",
    orgId: "org_local",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  setMem0FetchForTests(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  resetDailyExtractForTests();
  const now = new Date(shanghaiDateAtHour("2026-09-07", MEMORY_EXTRACT_HOUR) + userExtractOffsetMs(USER_ID));
  try {
    assert.equal(readMem0Info().configured, true);
    await work(now);
  } finally {
    resetDailyExtractForTests();
    setMem0FetchForTests(null);
    setAccountStore(null, "file");
    if (previousDir === undefined) delete process.env.RUNS_DIR;
    else process.env.RUNS_DIR = previousDir;
    if (previousUrl === undefined) delete process.env.MEM0_URL;
    else process.env.MEM0_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEM0_API_KEY;
    else process.env.MEM0_API_KEY = previousKey;
  }
}

test("daily sweep stamps a due user once", async () => {
  await withDailyExtractHarness(async (now) => {
    assert.equal(await sweepDailyExtracts(now), 0);
    assert.equal(readDailyExtractStamps()[USER_ID], "2026-09-06");
    assert.equal(await sweepDailyExtracts(now), 0);
    assert.equal(readDailyExtractStamps()[USER_ID], "2026-09-06");
  });
});

test("overlapping daily sweep ticks no-op until the first tick finishes", async () => {
  await withDailyExtractHarness(async (now) => {
    let startResolve!: () => void;
    let holdResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startResolve = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      holdResolve = resolve;
    });
    const keepAlive = setTimeout(() => undefined, 5_000);
    setDailyExtractBeforeWorkForTests(async () => {
      startResolve();
      await hold;
    });
    const first = sweepDailyExtracts(now);
    try {
      await started;
      assert.equal(isDailyExtractRunning(), true);
      assert.equal(await sweepDailyExtracts(now), 0);
    } finally {
      holdResolve();
      await first;
      clearTimeout(keepAlive);
    }
  });
});
