export function resolveChatModel(upstream?: string | null, model?: string | null, hasImages = false): string {
  if (upstream === "openai") return "gpt-4o-mini";
  if (/pro/i.test(model ?? "") && !/vision/i.test(model ?? "")) return "deepseek-v4-pro";
  if (hasImages || /vision/i.test(model ?? "")) return "deepseek-v4-flash-vision-exp";
  return "deepseek-v4-flash";
}

export function formatDuration(start: string, end?: string | null, now = new Date()): string {
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : now.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "";
  const sec = Math.max(1, Math.round((to - from) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m${rem}s` : `${min}m`;
}

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
  for (const key of ["command", "cmd", "path", "file", "query", "pattern", "url", "message", "title", "task", "agent"]) {
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
