import type { TranscriptMessage } from "./events.js";

export const ACTIVE_RUN_STATUSES = [
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
] as const;

const SETUP_STATUSES = new Set<string>(["NOT_YET_STARTED", "PROVISIONING", "INSTALLING"]);
const WORKING_STATUSES = new Set<string>(["RUNNING", "WAITING_FOR_BACKGROUND_WORK"]);
const TERMINAL_EVENT_KINDS = new Set(["run.idle", "run.error", "run.archived", "run.deleted"]);
const PENDING_USER_PREFIX = "pending-";

/** The server echo of an optimistic bubble can be stamped slightly before the local send time. */
export const PENDING_USER_ARRIVAL_MS = 5000;
/** Poll the snapshot when SSE has been quiet this long. */
export const TRANSCRIPT_STALE_MS = 3000;
export const QUEUED_SLOT_NOTICE = "两台云端电脑都在忙，已排队，空出来会自动开始";

export type PendingUser = {
  id: string;
  text: string;
  createdAt: string;
  images?: TranscriptMessage["images"];
};

export function isActiveRunStatus(status?: string | null): boolean {
  return Boolean(status && (ACTIVE_RUN_STATUSES as readonly string[]).includes(status));
}

export function isComposerClosed(status?: string | null): boolean {
  return status === "ARCHIVED" || status === "EXPIRED";
}

export function isTerminalTurnEvent(kind: string): boolean {
  return TERMINAL_EVENT_KINDS.has(kind);
}

/** Map a live event onto the run status a client should show. `null` keeps the current status. */
export function statusFromEventKind(kind: string, current?: string | null): string | null {
  switch (kind) {
    case "run.install_started":
      return "INSTALLING";
    case "run.provisioning":
      return "PROVISIONING";
    case "run.running":
    case "agent.start":
      return "RUNNING";
    case "user.message":
    case "followup.queued":
    case "followup.delivered":
      if (isComposerClosed(current) || (current && SETUP_STATUSES.has(current)) || (current && WORKING_STATUSES.has(current))) {
        return null;
      }
      return "RUNNING";
    case "run.idle":
      return "IDLE";
    case "agent.end":
      // The worker emits one agent.end per user turn; the control plane follows it with run.idle.
      return current && WORKING_STATUSES.has(current) ? "IDLE" : null;
    case "run.queued":
      return "NOT_YET_STARTED";
    case "run.archived":
    case "run.deleted":
      return "ARCHIVED";
    case "run.error":
      return "ERROR";
    default:
      return null;
  }
}

export function currentTurnMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  let lastUser = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      lastUser = index;
    }
  }
  return lastUser >= 0 ? messages.slice(lastUser + 1) : messages;
}

/**
 * Still producing output. `message.end` clears `streaming` per text burst while tools keep
 * running, so a running tool counts as live too.
 */
export function assistantIsLive(message: TranscriptMessage): boolean {
  if (message.streaming) return true;
  if (message.tools?.some((tool) => tool.status === "running")) return true;
  return Boolean(message.blocks?.some((block) => block.type === "tool" && block.tool.status === "running"));
}

export function runningToolName(messages: TranscriptMessage[]): string | null {
  const turn = currentTurnMessages(messages);
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const message = turn[index];
    const fromTools = message?.tools?.find((tool) => tool.status === "running")?.name;
    if (fromTools) return fromTools;
    const block = message?.blocks?.find((item) => item.type === "tool" && item.tool.status === "running");
    if (block?.type === "tool" && block.tool.name) return block.tool.name;
  }
  return null;
}

export function hasLiveAssistantWork(messages: TranscriptMessage[]): boolean {
  return currentTurnMessages(messages).some((message) => message.role === "assistant" && assistantIsLive(message));
}

/**
 * The assistant bubble that owns the open turn. `turnOpen` covers the gap between a text burst
 * ending and the next tool starting, when no message flag says the turn is still going.
 */
export function liveAssistantId(messages: TranscriptMessage[], turnOpen: boolean): string | null {
  const turn = currentTurnMessages(messages);
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const message = turn[index];
    if (message?.role !== "assistant") continue;
    return turnOpen || assistantIsLive(message) ? message.id : null;
  }
  return null;
}

export function isTurnBusy(input: {
  sending?: boolean;
  stopping?: boolean;
  pending?: boolean;
  status?: string | null;
  messages?: TranscriptMessage[];
}): boolean {
  if (input.sending || input.stopping || input.pending) return true;
  if (input.status === "ERROR" || isComposerClosed(input.status)) return false;
  if (isActiveRunStatus(input.status)) return true;
  return Boolean(input.messages && hasLiveAssistantWork(input.messages));
}

function isPendingUserId(id: string): boolean {
  return id.startsWith(PENDING_USER_PREFIX);
}

/** Same-text history must not count as this send; only a newer confirmed bubble. */
export function pendingUserArrived(messages: TranscriptMessage[], pending: PendingUser): boolean {
  const sentAt = Date.parse(pending.createdAt);
  return messages.some((message) => {
    if (message.role !== "user" || isPendingUserId(message.id) || message.text !== pending.text) {
      return false;
    }
    const arrivedAt = Date.parse(message.createdAt);
    return Number.isFinite(sentAt) && Number.isFinite(arrivedAt) && arrivedAt >= sentAt - PENDING_USER_ARRIVAL_MS;
  });
}

export function appendPendingUser(messages: TranscriptMessage[], pending: PendingUser): TranscriptMessage[] {
  if (messages.some((message) => message.id === pending.id) || pendingUserArrived(messages, pending)) {
    return messages;
  }
  return [
    ...messages,
    {
      id: pending.id,
      role: "user",
      text: pending.text,
      createdAt: pending.createdAt,
      images: pending.images?.length ? pending.images : undefined,
    },
  ];
}

export function withPendingUser(messages: TranscriptMessage[], pending: PendingUser | null): TranscriptMessage[] {
  return pending ? appendPendingUser(messages, pending) : messages;
}

export function dropResolvedPendingUsers(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter((message) => message.role !== "user" || !isPendingUserId(message.id) || !pendingUserArrived(messages, message));
}

export function mergeUnresolvedPending(loaded: TranscriptMessage[], previous: TranscriptMessage[]): TranscriptMessage[] {
  const extras = previous.filter(
    (message) => message.role === "user" && isPendingUserId(message.id) && !pendingUserArrived(loaded, message),
  );
  return extras.length === 0 ? loaded : dropResolvedPendingUsers([...loaded, ...extras]);
}

export function shouldRefreshTranscript(input: {
  lastSseAt: number;
  now?: number;
  staleMs?: number;
  status?: string | null;
}): boolean {
  if (input.status === "NOT_YET_STARTED") return true;
  return (input.now ?? Date.now()) - input.lastSseAt >= (input.staleMs ?? TRANSCRIPT_STALE_MS);
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
