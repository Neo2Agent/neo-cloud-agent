import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";

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

export function pendingUserMessage(text: string, now = new Date().toISOString()): TranscriptMessage {
  return { id: `pending-${now}`, role: "user", text, createdAt: now };
}

export const QUEUED_SLOT_NOTICE = "两台云端电脑都在忙，已排队，空出来会自动开始";

export function shouldRefreshTranscript(input: {
  lastSseAt: number;
  now?: number;
  staleMs?: number;
  status?: string | null;
}): boolean {
  if (input.status === "NOT_YET_STARTED") return true;
  return (input.now ?? Date.now()) - input.lastSseAt >= (input.staleMs ?? 3000);
}

export function withQueuedNotice(
  messages: TranscriptMessage[],
  status?: string | null,
  now = new Date().toISOString(),
): TranscriptMessage[] {
  if (status !== "NOT_YET_STARTED") return messages;
  if (messages.some((message) => message.kind === "run.queued" || message.text.includes("已排队，空出来"))) {
    return messages;
  }
  return [
    ...messages,
    {
      id: `local-queued-${now}`,
      role: "setup",
      text: QUEUED_SLOT_NOTICE,
      createdAt: now,
      kind: "run.queued",
    },
  ];
}

export function sendFailureMessage(text: string, now = new Date().toISOString()): TranscriptMessage {
  return {
    id: `err-${now}`,
    role: "setup",
    text,
    createdAt: now,
    kind: "run.error",
    level: "error",
  };
}
