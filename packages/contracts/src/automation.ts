export type AutomationSchedule =
  | { kind: "every"; minutes: number }
  | { kind: "daily"; hour: number; minute?: number }
  | { kind: "weekly"; weekday: number; hour: number; minute?: number };

export type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  prompt: string;
  repoUrls: string[];
  schedule: AutomationSchedule;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAutomationRequest = {
  name?: string;
  prompt: string;
  repoUrls?: string[];
  schedule: AutomationSchedule;
  enabled?: boolean;
};

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function parseAutomationSchedule(input: unknown): AutomationSchedule {
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const kind = typeof record.kind === "string" ? record.kind : "";
  if (kind === "every") {
    const minutes = Number(record.minutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 60 * 24 * 30) {
      throw new Error("every schedule needs minutes between 5 and 43200");
    }
    return { kind: "every", minutes: Math.round(minutes) };
  }
  if (kind === "daily") {
    const hour = Number(record.hour);
    const minute = record.minute == null ? 0 : Number(record.minute);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new Error("daily schedule needs hour 0-23 and minute 0-59");
    }
    return { kind: "daily", hour, minute };
  }
  if (kind === "weekly") {
    const weekday = Number(record.weekday);
    const hour = Number(record.hour);
    const minute = record.minute == null ? 0 : Number(record.minute);
    if (
      !Number.isInteger(weekday) ||
      weekday < 1 ||
      weekday > 7 ||
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isInteger(minute) ||
      minute < 0 ||
      minute > 59
    ) {
      throw new Error("weekly schedule needs weekday 1-7 (Mon-Sun), hour 0-23, minute 0-59");
    }
    return { kind: "weekly", weekday, hour, minute };
  }
  throw new Error("schedule kind must be every, daily, or weekly");
}

export function describeAutomationSchedule(schedule: AutomationSchedule): string {
  const minute = schedule.kind === "every" ? 0 : (schedule.minute ?? 0);
  const clock = schedule.kind === "every" ? "" : `${String(schedule.hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (schedule.kind === "every") {
    return schedule.minutes % 60 === 0 ? `每 ${schedule.minutes / 60} 小时` : `每 ${schedule.minutes} 分钟`;
  }
  if (schedule.kind === "daily") {
    return `每天 ${clock}`;
  }
  const days = ["一", "二", "三", "四", "五", "六", "日"];
  return `每周${days[schedule.weekday - 1] ?? "?"} ${clock}`;
}

export function nextAutomationRunAt(schedule: AutomationSchedule, from = new Date()): Date {
  if (schedule.kind === "every") {
    return new Date(from.getTime() + schedule.minutes * 60_000);
  }
  const wall = shanghaiWall(from);
  const minute = schedule.minute ?? 0;
  if (schedule.kind === "daily") {
    let candidate = fromShanghaiWall({
      year: wall.year,
      month: wall.month,
      date: wall.date,
      hour: schedule.hour,
      minute,
    });
    if (candidate.getTime() <= from.getTime()) {
      candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    }
    return candidate;
  }
  const targetJs = schedule.weekday === 7 ? 0 : schedule.weekday;
  let daysAhead = (targetJs - wall.weekday + 7) % 7;
  let candidate = fromShanghaiWall({
    year: wall.year,
    month: wall.month,
    date: wall.date + daysAhead,
    hour: schedule.hour,
    minute,
  });
  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(candidate.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return candidate;
}

function shanghaiWall(date: Date): { year: number; month: number; date: number; hour: number; minute: number; weekday: number } {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

function fromShanghaiWall(parts: { year: number; month: number; date: number; hour: number; minute: number }): Date {
  return new Date(Date.UTC(parts.year, parts.month, parts.date, parts.hour, parts.minute, 0, 0) - SHANGHAI_OFFSET_MS);
}
