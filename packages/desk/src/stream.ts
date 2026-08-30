import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts/events";

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

export function isTerminalTurnEvent(kind: string): boolean {
  return TERMINAL_EVENT_KINDS.has(kind);
}

const TURN_WORK_KINDS = new Set([
  "agent.start",
  "user.message",
  "followup.delivered",
  "tool.start",
  "tool.update",
  "tool.end",
  "message.start",
  "message.delta",
]);

/** Last signal in a live batch: idle after tools still means the turn may be done. */
export function batchTurnSignal(events: Array<{ kind: string }>): "work" | "idle" | "fail" | null {
  let signal: "work" | "idle" | "fail" | null = null;
  for (const event of events) {
    if (event.kind === "run.error" || event.kind === "run.archived" || event.kind === "run.deleted") {
      signal = "fail";
    } else if (event.kind === "run.idle") {
      signal = "idle";
    } else if (TURN_WORK_KINDS.has(event.kind)) {
      signal = "work";
    }
  }
  return signal;
}

/**
 * Status the open run should show for one event. Without this the run bar and
 * the composer stop button keep claiming a turn is live long after it ended.
 */
export function statusFromEventKind(kind: string, current?: string | null): string | null {
  switch (kind) {
    case "run.idle":
      return "IDLE";
    case "agent.end":
      // pi ends every LLM round. The turn is not done until run.idle sticks.
      return null;
    case "run.error":
      return "ERROR";
    case "run.archived":
      return "ARCHIVED";
    case "run.deleted":
      return "ARCHIVED";
    case "agent.start":
    case "user.message":
    case "followup.delivered":
      return "RUNNING";
    case "followup.queued":
      return isActiveRunStatus(current) ? current ?? "RUNNING" : "RUNNING";
    default:
      return null;
  }
}

export function parseSse(raw: string): RunEvent | null {
  try {
    const event = JSON.parse(raw) as RunEvent;
    return event?.id && event.kind ? event : null;
  } catch {
    return null;
  }
}

/** Build `/v1/runs/:id/events` query. `after` must be the transcript snapshot cursor. */
export function runEventsQuery(
  opts: { after?: string | null; accessToken?: string | null; client?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (opts.after) params.set("after", opts.after);
  if (opts.accessToken) params.set("access_token", opts.accessToken);
  if (opts.client) params.set("client", opts.client);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function messageIsLive(message: TranscriptMessage): boolean {
  if (message.streaming) return true;
  if (message.tools?.some((tool) => tool.status === "running")) return true;
  return Boolean(message.blocks?.some((block) => block.type === "tool" && block.tool.status === "running"));
}

export function runningToolName(messages: TranscriptMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const fromTools = message?.tools?.find((tool) => tool.status === "running")?.name;
    if (fromTools) return fromTools;
    const block = message?.blocks?.find((item) => item.type === "tool" && item.tool.status === "running");
    if (block?.type === "tool" && block.tool.name) return block.tool.name;
  }
  return null;
}

export function liveActivityLabel(messages: TranscriptMessage[]): string | null {
  const tool = runningToolName(messages);
  if (tool) return `正在执行 ${tool}…`;
  const streaming = [...messages].reverse().find((message) => message.role === "assistant" && message.streaming);
  if (streaming && !streaming.text.trim()) return "正在回复…";
  return null;
}

export function assistantHasVisibleReply(message: TranscriptMessage): boolean {
  if (message.role !== "assistant") return false;
  if (message.text.trim()) return true;
  if (message.tools?.length) return true;
  return Boolean(
    message.blocks?.some(
      (block) => block.type === "tool" || (block.type === "text" && Boolean(block.text.trim())),
    ),
  );
}

/** Dots while the turn is open and nothing is visibly streaming or running. */
export function shouldShowThinking(busy: boolean, messages: TranscriptMessage[]): boolean {
  if (!busy) return false;
  if (runningToolName(messages)) return false;
  const streamingText = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.streaming && Boolean(message.text.trim()));
  return !streamingText;
}

function turnMessages(messages: TranscriptMessage[], messageIndex: number): TranscriptMessage[] {
  let start = 0;
  for (let index = 0; index <= messageIndex && index < messages.length; index += 1) {
    if (messages[index]?.role === "user") start = index + 1;
  }
  let end = messages.length;
  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      end = index;
      break;
    }
  }
  return messages.slice(start, end);
}

function turnIsLive(messages: TranscriptMessage[]): boolean {
  return messages.some(messageIsLive) || Boolean(liveActivityLabel(messages));
}

/** One thumbs/copy bar, only after the whole turn is idle, on the last assistant message. */
export type PendingUser = {
  id: string;
  text: string;
  createdAt: string;
  images?: { mediaType: string; data: string }[];
};

function isPendingUserId(id: string): boolean {
  return id.startsWith("pending-");
}

/** Same-text history must not count as this send; only a newer confirmed bubble. */
export function pendingUserArrived(messages: TranscriptMessage[], pending: PendingUser): boolean {
  const sentAt = Date.parse(pending.createdAt);
  return messages.some((message) => {
    if (message.role !== "user" || isPendingUserId(message.id) || message.text !== pending.text) {
      return false;
    }
    const arrivedAt = Date.parse(message.createdAt);
    return Number.isFinite(sentAt) && Number.isFinite(arrivedAt) && arrivedAt >= sentAt - 2000;
  });
}

export function appendPendingUser(messages: TranscriptMessage[], pending: PendingUser): TranscriptMessage[] {
  if (messages.some((message) => message.id === pending.id)) {
    return messages;
  }
  if (pendingUserArrived(messages, pending)) {
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

export function dropResolvedPendingUsers(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter((message) => {
    if (message.role !== "user" || !isPendingUserId(message.id)) {
      return true;
    }
    return !pendingUserArrived(messages, {
      id: message.id,
      text: message.text,
      createdAt: message.createdAt,
      images: message.images,
    });
  });
}

export function mergeUnresolvedPending(
  loaded: TranscriptMessage[],
  previous: TranscriptMessage[],
): TranscriptMessage[] {
  const extras = previous.filter(
    (message) =>
      message.role === "user" &&
      isPendingUserId(message.id) &&
      !pendingUserArrived(loaded, {
        id: message.id,
        text: message.text,
        createdAt: message.createdAt,
        images: message.images,
      }),
  );
  if (extras.length === 0) {
    return loaded;
  }
  return dropResolvedPendingUsers([...loaded, ...extras]);
}

export function withPendingUser(messages: TranscriptMessage[], pending: PendingUser | null): TranscriptMessage[] {
  if (!pending) return messages;
  return appendPendingUser(messages, pending);
}

export function shouldShowAssistantActions(
  messages: TranscriptMessage[],
  messageIndex: number,
  turnComplete = true,
): boolean {
  if (!turnComplete) return false;
  const message = messages[messageIndex];
  if (!message || message.role !== "assistant") return false;
  const turn = turnMessages(messages, messageIndex);
  if (turnIsLive(turn)) return false;
  const lastAssistant = [...turn].reverse().find((item) => item.role === "assistant");
  return lastAssistant?.id === message.id;
}
