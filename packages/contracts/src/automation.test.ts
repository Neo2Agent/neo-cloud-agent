import assert from "node:assert/strict";
import test from "node:test";
import { describeAutomationSchedule, nextAutomationRunAt, parseAutomationSchedule } from "./automation.js";

test("parseAutomationSchedule accepts the dad-friendly presets", () => {
  assert.deepEqual(parseAutomationSchedule({ kind: "every", minutes: 60 }), { kind: "every", minutes: 60 });
  assert.deepEqual(parseAutomationSchedule({ kind: "daily", hour: 9 }), { kind: "daily", hour: 9, minute: 0 });
  assert.deepEqual(parseAutomationSchedule({ kind: "weekly", weekday: 1, hour: 9, minute: 30 }), {
    kind: "weekly",
    weekday: 1,
    hour: 9,
    minute: 30,
  });
  assert.throws(() => parseAutomationSchedule({ kind: "daily", hour: 25 }));
});

test("describeAutomationSchedule is Chinese and readable", () => {
  assert.equal(describeAutomationSchedule({ kind: "every", minutes: 60 }), "每 1 小时");
  assert.equal(describeAutomationSchedule({ kind: "daily", hour: 9, minute: 0 }), "每天 09:00");
  assert.equal(describeAutomationSchedule({ kind: "weekly", weekday: 1, hour: 9 }), "每周一 09:00");
});

test("nextAutomationRunAt uses Asia/Shanghai wall time without DST", () => {
  const mondayMorning = new Date("2026-08-24T00:10:00.000Z"); // 08:10 Shanghai Monday
  const daily = nextAutomationRunAt({ kind: "daily", hour: 9 }, mondayMorning);
  assert.equal(daily.toISOString(), "2026-08-24T01:00:00.000Z");
  const weekly = nextAutomationRunAt({ kind: "weekly", weekday: 1, hour: 9 }, mondayMorning);
  assert.equal(weekly.toISOString(), "2026-08-24T01:00:00.000Z");
  const afterNine = nextAutomationRunAt({ kind: "weekly", weekday: 1, hour: 9 }, new Date("2026-08-24T01:10:00.000Z"));
  assert.equal(afterNine.toISOString(), "2026-08-31T01:00:00.000Z");
  const hourly = nextAutomationRunAt({ kind: "every", minutes: 60 }, mondayMorning);
  assert.equal(hourly.toISOString(), "2026-08-24T01:10:00.000Z");
});
