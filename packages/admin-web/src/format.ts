const SHANGHAI = "Asia/Shanghai";

export const STATUS_LABELS: Record<string, string> = {
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

export const STATUS_TONE: Record<string, "run" | "ok" | "warn" | "err" | "muted"> = {
  NOT_YET_STARTED: "muted",
  PROVISIONING: "run",
  INSTALLING: "run",
  RUNNING: "run",
  IDLE: "ok",
  WAITING_FOR_BACKGROUND_WORK: "warn",
  ERROR: "err",
  ARCHIVED: "muted",
  EXPIRED: "muted",
};

const SOURCE_LABELS: Record<string, string> = {
  web: "对话页",
  automation: "定时任务",
  cli: "命令行",
  telegram: "Telegram",
  wechat: "微信",
  desk: "Desk",
  mobile: "手机",
};

const POLICY_LABELS: Record<string, string> = {
  ip: "IP",
  login: "登录",
  login_account: "账号登录",
  webhook: "Webhook",
  api: "接口",
  write: "写入",
  create_run: "新建对话",
  follow_up: "追问",
  expensive: "重操作",
  sse: "实时流",
  llm_run: "模型 / 对话",
  llm_org: "模型 / 组织",
  llm_inflight_run: "在飞推理 / 对话",
  llm_inflight_org: "在飞推理 / 组织",
};

function shanghaiYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI, year: "numeric" }).format(date);
}

/** Asia/Shanghai wall clock, e.g. `8/24 17:30`. Drops the year when it matches `now`. */
export function formatWhen(value: string | null | undefined, now = new Date()): string {
  if (!value) return "—";
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

export function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const compact = value / 1_000_000;
    return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 10_000) {
    const compact = value / 1000;
    return `${compact >= 100 ? compact.toFixed(0) : compact.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return formatCount(value);
}

export function quotaPercent(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / max) * 100)));
}

export function formatWindow(windowMs: number): string {
  if (windowMs <= 0) return "并发";
  if (windowMs % 3_600_000 === 0) return `${windowMs / 3_600_000} 小时`;
  if (windowMs % 60_000 === 0) return `${windowMs / 60_000} 分钟`;
  return `${Math.max(1, Math.round(windowMs / 1000))} 秒`;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status: string): "run" | "ok" | "warn" | "err" | "muted" {
  return STATUS_TONE[status] ?? "muted";
}

export function sourceLabel(source?: string): string {
  if (!source) return "";
  return SOURCE_LABELS[source] ?? source;
}

export function policyLabel(name: string): string {
  return POLICY_LABELS[name] ?? name;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function preview(text: string, max = 72): string {
  return (text || "未命名任务").replace(/\s+/g, " ").trim().slice(0, max);
}

export function slotLabel(id?: string | null): string {
  const raw = String(id || "");
  const match = /^slot-(\d+)$/.exec(raw);
  if (match) return `槽 ${Number(match[1]) + 1}`;
  return raw || "未分配";
}

export function slotBusy(status: string): boolean {
  return status === "busy" || status === "claimed" || status === "running";
}
