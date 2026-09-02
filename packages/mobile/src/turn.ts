import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";

export const ACTIVE_RUN_STATUSES = [
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
] as const;

const TERMINAL_EVENT_KINDS = new Set(["run.idle", "run.error", "run.archived", "run.deleted"]);

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
  // pi emits agent.end after every LLM round. The turn is not idle until run.idle.
  if (kind === "run.idle") return "IDLE";
  if (kind === "run.error") return "ERROR";
  if (kind === "run.archived") return "ARCHIVED";
  if (kind === "run.deleted") return "ARCHIVED";
  return fallback;
}

export function pendingUserMessage(text: string, now = new Date().toISOString()): TranscriptMessage {
  return { id: `pending-${now}`, role: "user", text, createdAt: now };
}

function isPendingUserId(id: string): boolean {
  return id.startsWith("pending-");
}

export function pendingUserArrived(messages: TranscriptMessage[], pending: TranscriptMessage): boolean {
  const sentAt = Date.parse(pending.createdAt);
  return messages.some((message) => {
    if (message.role !== "user" || isPendingUserId(message.id) || message.text !== pending.text) {
      return false;
    }
    const arrivedAt = Date.parse(message.createdAt);
    return Number.isFinite(sentAt) && Number.isFinite(arrivedAt) && arrivedAt >= sentAt - 2000;
  });
}

export function appendPendingUser(messages: TranscriptMessage[], pending: TranscriptMessage): TranscriptMessage[] {
  if (messages.some((message) => message.id === pending.id) || pendingUserArrived(messages, pending)) {
    return messages;
  }
  return [...messages, pending];
}

export function dropResolvedPendingUsers(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter((message) => {
    if (message.role !== "user" || !isPendingUserId(message.id)) return true;
    return !pendingUserArrived(messages, message);
  });
}

export function mergeUnresolvedPending(
  loaded: TranscriptMessage[],
  previous: TranscriptMessage[],
): TranscriptMessage[] {
  const extras = previous.filter(
    (message) =>
      message.role === "user" && isPendingUserId(message.id) && !pendingUserArrived(loaded, message),
  );
  return extras.length === 0 ? loaded : dropResolvedPendingUsers([...loaded, ...extras]);
}

export function withPendingUser(messages: TranscriptMessage[], pending: TranscriptMessage | null): TranscriptMessage[] {
  return pending ? appendPendingUser(messages, pending) : messages;
}

export const QUEUED_SLOT_NOTICE = "两台云端电脑都在忙，已排队，空出来会自动开始";
export const DESK_STARTING_NOTICE = "正在这台电脑上启动 Agent";

const STARTUP_WHISPERS = new Set([
  DESK_STARTING_NOTICE,
  QUEUED_SLOT_NOTICE,
  "已派给这台电脑，等待启动",
  "等待这台电脑上线",
]);

export function isStartupWhisper(message: Pick<TranscriptMessage, "kind" | "role" | "text">): boolean {
  if (message.kind === "run.queued") return true;
  return message.role === "setup" && STARTUP_WHISPERS.has(message.text.trim());
}

export function generationStarted(messages: TranscriptMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "assistant") return false;
    if (message.text.trim()) return true;
    if (message.tools?.length) return true;
    return Boolean(message.blocks?.some((block) => (block.type === "text" ? Boolean(block.text.trim()) : true)));
  });
}

/** Hide the empty assistant shell that arrives on message.start before any tokens. */
export function hasVisibleTranscript(message: TranscriptMessage): boolean {
  if (message.role === "user") {
    return Boolean(message.text.trim() || message.images?.length);
  }
  return transcriptGroups(message).some((group) =>
    group.type === "tools" ? group.tools.length > 0 : Boolean(group.text.trim()),
  );
}

function currentTurnMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  let lastUser = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") lastUser = index;
  }
  return lastUser >= 0 ? messages.slice(lastUser + 1) : messages;
}

function hasRunningTool(messages: TranscriptMessage[]): boolean {
  return messages.some(
    (message) =>
      Boolean(message.tools?.some((tool) => tool.status === "running")) ||
      Boolean(message.blocks?.some((block) => block.type === "tool" && block.tool.status === "running")),
  );
}

/** Dots only before this turn has anything to show. Do not come back after the reply lands. */
export function shouldShowThinking(busy: boolean, messages: TranscriptMessage[]): boolean {
  if (!busy) return false;
  const turn = currentTurnMessages(messages);
  if (hasRunningTool(turn)) return false;
  return !turn.some((message) => message.role === "assistant" && hasVisibleTranscript(message));
}

export function thinkingHint(input: {
  status?: string | null;
  loop?: string | null;
  remoteControl?: boolean;
}): string {
  const local = input.loop === "desk" || Boolean(input.remoteControl);
  const settingUp =
    !input.status ||
    input.status === "NOT_YET_STARTED" ||
    input.status === "PROVISIONING" ||
    input.status === "INSTALLING";
  if (settingUp && local) return "正在启动本机 Worker…";
  if (settingUp) return "正在启动 Worker…";
  return "正在思考…";
}

export function shouldRefreshTranscript(input: {
  lastSseAt: number;
  now?: number;
  staleMs?: number;
  status?: string | null;
}): boolean {
  if (input.status === "NOT_YET_STARTED") return true;
  return (input.now ?? Date.now()) - input.lastSseAt >= (input.staleMs ?? 3000);
}

/**
 * SSE went quiet, so this poll pays for the transcript body only when the run
 * produced a new event. Comparing ids also covers token deltas, which never
 * bump `updatedAt`. A server that reports no cursor keeps the old behaviour.
 */
export function transcriptBodyNeeded(input: {
  appliedEventId?: string | null;
  runLastEventId?: string | null;
}): boolean {
  if (!input.runLastEventId) {
    return true;
  }
  return input.runLastEventId !== (input.appliedEventId ?? null);
}

/** While SSE is painting tokens, a GET snapshot must not replace the live transcript. */
export function shouldReplaceLiveTranscript(input: {
  liveSse: boolean;
  lastSseAt: number;
  now?: number;
  freshMs?: number;
}): boolean {
  if (!input.liveSse) return true;
  return (input.now ?? Date.now()) - input.lastSseAt >= (input.freshMs ?? 4000);
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
