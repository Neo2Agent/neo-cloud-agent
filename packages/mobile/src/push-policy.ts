export function runIdFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const runId = (data as { runId?: unknown }).runId;
  return typeof runId === "string" && runId.trim() ? runId : null;
}

export function shouldShowLocalPushBanner(opts: {
  appInForeground: boolean;
  liveSse: boolean;
  notifyingRunId?: string | null;
  openRunId?: string | null;
}): boolean {
  if (!opts.appInForeground) return true;
  if (!opts.liveSse) return true;
  if (opts.notifyingRunId && opts.openRunId && opts.notifyingRunId !== opts.openRunId) return true;
  return false;
}
