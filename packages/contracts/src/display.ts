const SHANGHAI = "Asia/Shanghai";
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;
const TOOL_PREVIEW_KEYS = ["command", "cmd", "path", "file", "query", "pattern", "url", "message", "title", "task", "agent"];

export const RUN_STATUS_LABELS: Readonly<Record<string, string>> = {
  NOT_YET_STARTED: "排队中",
  PROVISIONING: "准备中",
  INSTALLING: "安装中",
  RUNNING: "运行中",
  IDLE: "空闲",
  WAITING_FOR_BACKGROUND_WORK: "后台任务",
  ERROR: "出错",
  ARCHIVED: "已归档",
  EXPIRED: "已过期",
};

export function sameClockMinute(left: string, right: string): boolean {
  const start = Date.parse(left);
  const end = Date.parse(right);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return left === right;
  return Math.floor(start / MS_PER_MINUTE) === Math.floor(end / MS_PER_MINUTE);
}

function shanghaiYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI, year: "numeric" }).format(date);
}

/** Asia/Shanghai wall clock, e.g. `8/24 17:30`. Drops the year when it matches `now`. */
export function formatWhen(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const sameYear = shanghaiYear(date) === shanghaiYear(now);
  return date.toLocaleString("zh-CN", {
    timeZone: SHANGHAI,
    year: sameYear ? undefined : "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Elapsed time as `12s`, `3m2s`, or `2m`. */
export function formatDuration(start: string, end?: string | null, now = new Date()): string {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "";
  const sec = Math.max(1, Math.round((to - from) / MS_PER_SECOND));
  if (sec < SECONDS_PER_MINUTE) return `${sec}s`;
  const min = Math.floor(sec / SECONDS_PER_MINUTE);
  const rem = sec % SECONDS_PER_MINUTE;
  return rem ? `${min}m${rem}s` : `${min}m`;
}

/** One-line summary of tool arguments: the command, path, query, or subagent task. */
export function toolArgPreview(args: unknown): string {
  if (!args || typeof args !== "object") {
    return args == null ? "" : String(args);
  }
  const record = args as Record<string, unknown>;
  const agent = typeof record.agent === "string" ? record.agent.trim() : "";
  const task = typeof record.task === "string" ? record.task.trim() : "";
  if (agent && task) {
    return `${agent}: ${task.replace(/\s+/g, " ").trim()}`;
  }
  if (Array.isArray(record.tasks) && record.tasks.length > 0) {
    return `parallel ×${record.tasks.length}`;
  }
  if (Array.isArray(record.chain) && record.chain.length > 0) {
    return `chain ×${record.chain.length}`;
  }
  for (const key of TOOL_PREVIEW_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, " ").trim();
    }
  }
  try {
    return JSON.stringify(args);
  } catch {
    return "";
  }
}
