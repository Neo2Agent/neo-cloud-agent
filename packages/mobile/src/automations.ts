import type { AutomationSchedule } from "@neo-cloud-agent/contracts/automation";

export type ScheduleKind = "hourly" | "six_hours" | "daily_09" | "weekly_mon_09";

export const SCHEDULE_PRESETS: Array<{ id: ScheduleKind; label: string; schedule: AutomationSchedule }> = [
  { id: "hourly", label: "每小时", schedule: { kind: "every", minutes: 60 } },
  { id: "six_hours", label: "每 6 小时", schedule: { kind: "every", minutes: 360 } },
  { id: "daily_09", label: "每天上午 9 点", schedule: { kind: "daily", hour: 9 } },
  { id: "weekly_mon_09", label: "每周一上午 9 点", schedule: { kind: "weekly", weekday: 1, hour: 9 } },
];

export function schedulePreset(id: ScheduleKind): AutomationSchedule {
  const found = SCHEDULE_PRESETS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown schedule ${id}`);
  return found.schedule;
}
