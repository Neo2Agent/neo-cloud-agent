import assert from "node:assert/strict";
import test from "node:test";
import { SCHEDULE_PRESETS, schedulePreset } from "./automations.js";

test("mobile automations reuse Desk schedule presets", () => {
  assert.equal(SCHEDULE_PRESETS.length, 4);
  assert.deepEqual(schedulePreset("daily_09"), { kind: "daily", hour: 9 });
  assert.deepEqual(schedulePreset("hourly"), { kind: "every", minutes: 60 });
});
