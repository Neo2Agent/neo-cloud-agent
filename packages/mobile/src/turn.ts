export const ACTIVE_RUN_STATUSES = [
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
] as const;

const TERMINAL_EVENT_KINDS = new Set(["run.idle", "run.error", "run.archived"]);

export function isActiveRunStatus(status?: string | null): boolean {
  return Boolean(status && (ACTIVE_RUN_STATUSES as readonly string[]).includes(status));
}

export function isComposerClosed(status?: string | null): boolean {
  return status === "ARCHIVED" || status === "EXPIRED";
}

export function isTerminalTurnEvent(kind: string): boolean {
  return TERMINAL_EVENT_KINDS.has(kind);
}

export function statusFromEventKind(kind: string, fallback?: string): string | undefined {
  if (kind === "run.queued" || kind === "run.provisioning") return "PROVISIONING";
  if (kind === "run.install_started") return "INSTALLING";
  if (kind === "run.running") return "RUNNING";
  if (kind === "run.idle" || kind === "agent.end") return "IDLE";
  if (kind === "run.error") return "ERROR";
  if (kind === "run.archived") return "ARCHIVED";
  return fallback;
}
