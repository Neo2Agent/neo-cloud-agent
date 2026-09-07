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
  MEMORY_EXTRACT_USER_CONCURRENCY,
  isDailyExtractRunning,
  isUserExtractDue,
  nextDailyExtractDelayMs,
  readDailyExtractStamps,
  resetDailyExtractForTests,
  runMayContainShanghaiDate,
  selectMessagesOnShanghaiDate,
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

test("daily extract uses Shanghai 02:00 and a four-hour user stagger", () => {
  assert.equal(MEMORY_EXTRACT_HOUR, 2);
  assert.equal(MEMORY_EXTRACT_USER_CONCURRENCY, 2);
  assert.equal(shanghaiDate(SHANGHAI_SEPT7_0200), "2026-09-07");
  assert.equal(shanghaiTargetDate(SHANGHAI_SEPT7_0200), "2026-09-06");
  assert.equal(shanghaiDate("2026-09-06T15:59:59.000Z"), "2026-09-06");
  assert.equal(shanghaiDate("2026-09-06T16:00:00.000Z"), "2026-09-07");
  assert.equal(shanghaiTargetDate(new Date("2026-08-31T18:00:00.000Z")), "2026-08-31");
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

test("next wake is the due slot, zero if already due, tomorrow after stamp", () => {
  const offset = userExtractOffsetMs(USER_ID);
  const windowStart = shanghaiDateAtHour("2026-09-07", MEMORY_EXTRACT_HOUR);
  const before = new Date(windowStart + offset - 1_000);
  const after = new Date(windowStart + offset + 1_000);
  assert.equal(nextDailyExtractDelayMs({ now: before, userIds: [USER_ID] }), 1_000);
  assert.equal(nextDailyExtractDelayMs({ now: after, userIds: [USER_ID] }), 0);
  const afterStamp = nextDailyExtractDelayMs({
    now: after,
    userIds: [USER_ID],
    stamps: { [USER_ID]: "2026-09-06" },
  });
  const tomorrowSlot = shanghaiDateAtHour("2026-09-08", MEMORY_EXTRACT_HOUR) + offset;
  assert.equal(afterStamp, tomorrowSlot - after.getTime());
  const beforeOpen = new Date(shanghaiDateAtHour("2026-09-07", MEMORY_EXTRACT_HOUR) - 5_000);
  assert.equal(nextDailyExtractDelayMs({ now: beforeOpen, userIds: [] }), 5_000);
});

test("user is due exactly when the next wake delay is zero", () => {
  const offset = userExtractOffsetMs(USER_ID);
  const windowStart = shanghaiDateAtHour("2026-09-07", MEMORY_EXTRACT_HOUR);
  const cases: Array<{ now: Date; lastTargetDate?: string }> = [
    { now: new Date(windowStart + offset - 1_000) },
    { now: new Date(windowStart + offset) },
    { now: new Date(windowStart + offset + 1_000) },
    { now: new Date(windowStart + offset + 1_000), lastTargetDate: "2026-09-06" },
    { now: new Date(windowStart + offset + 1_000), lastTargetDate: "2026-09-05" },
    { now: new Date(shanghaiDateAtHour("2026-09-07", MEMORY_EXTRACT_HOUR) - 5_000) },
  ];
  for (const item of cases) {
    const due = isUserExtractDue({ userId: USER_ID, now: item.now, lastTargetDate: item.lastTargetDate });
    const delay = nextDailyExtractDelayMs({
      now: item.now,
      userIds: [USER_ID],
      stamps: item.lastTargetDate ? { [USER_ID]: item.lastTargetDate } : {},
    });
    assert.equal(due, delay === 0);
  }
});

test("yesterday activity is the message Shanghai date, not updatedAt equality", () => {
  const targetDate = "2026-09-06";
  assert.equal(
    runMayContainShanghaiDate(
      { id: "continued", createdAt: "2026-09-05T10:00:00.000Z", updatedAt: "2026-09-07T02:00:00.000Z" },
      targetDate,
    ),
    true,
  );
  assert.equal(
    runMayContainShanghaiDate(
      { id: "today-only", createdAt: "2026-09-06T18:00:00.000Z", updatedAt: "2026-09-07T02:00:00.000Z" },
      targetDate,
    ),
    false,
  );
  assert.equal(
    runMayContainShanghaiDate({ id: "stale", updatedAt: "2026-09-05T10:00:00.000Z" }, targetDate),
    false,
  );
  assert.deepEqual(
    selectMessagesOnShanghaiDate(
      [
        { role: "user", text: "6 日的话", createdAt: "2026-09-06T08:00:00.000Z" },
        { role: "assistant", text: "6 日的回", createdAt: "2026-09-06T08:01:00.000Z" },
        { role: "user", text: "7 日续聊", createdAt: "2026-09-06T18:00:00.000Z" },
        { role: "assistant", text: "  ", createdAt: "2026-09-06T08:02:00.000Z" },
      ],
      targetDate,
    ).map((message) => message.text),
    ["6 日的话", "6 日的回"],
  );
});

test("daily extract keeps a continued run and drops stale or today-only runs", () => {
  const selected = selectRunsForDailyExtract(
    [
      {
        id: "stale",
        userId: USER_ID,
        createdAt: "2026-09-04T10:00:00.000Z",
        updatedAt: "2026-09-05T10:00:00.000Z",
      },
      {
        id: "yesterday",
        userId: USER_ID,
        createdAt: "2026-09-06T08:00:00.000Z",
        updatedAt: "2026-09-06T12:00:00.000Z",
      },
      {
        id: "continued",
        userId: USER_ID,
        createdAt: "2026-09-05T10:00:00.000Z",
        updatedAt: "2026-09-07T02:00:00.000Z",
      },
      {
        id: "today-only",
        userId: USER_ID,
        createdAt: "2026-09-06T18:00:00.000Z",
        updatedAt: "2026-09-07T02:00:00.000Z",
      },
      {
        id: "other",
        userId: "someone",
        createdAt: "2026-09-06T08:00:00.000Z",
        updatedAt: "2026-09-06T09:00:00.000Z",
      },
    ],
    USER_ID,
    "2026-09-06",
  );
  assert.deepEqual(
    selected.map((run) => run.id),
    ["continued", "yesterday"],
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
