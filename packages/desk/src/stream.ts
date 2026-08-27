import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts/events";

export const ACTIVE_RUN_STATUSES = [
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
] as const;

const TERMINAL_EVENT_KINDS = new Set(["run.idle", "run.error", "run.archived", "agent.end"]);

export function isActiveRunStatus(status?: string | null): boolean {
  return Boolean(status && (ACTIVE_RUN_STATUSES as readonly string[]).includes(status));
}

export function isTerminalTurnEvent(kind: string): boolean {
  return TERMINAL_EVENT_KINDS.has(kind);
}

/**
 * Status the open run should show for one event. Without this the run bar and
 * the composer stop button keep claiming a turn is live long after it ended.
 */
export function statusFromEventKind(kind: string, current?: string | null): string | null {
  switch (kind) {
    case "run.idle":
    case "agent.end":
      return "IDLE";
    case "run.error":
      return "ERROR";
    case "run.archived":
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
export function runEventsQuery(opts: { after?: string | null; accessToken?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.after) params.set("after", opts.after);
  if (opts.accessToken) params.set("access_token", opts.accessToken);
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

export function turnIsLive(messages: TranscriptMessage[]): boolean {
  return messages.some(messageIsLive) || Boolean(liveActivityLabel(messages));
}

/** One thumbs/copy bar, only after the whole turn is idle, on the last assistant message. */
export function shouldShowAssistantActions(messages: TranscriptMessage[], messageIndex: number): boolean {
  const message = messages[messageIndex];
  if (!message || message.role !== "assistant") return false;
  const turn = turnMessages(messages, messageIndex);
  if (turnIsLive(turn)) return false;
  const lastAssistant = [...turn].reverse().find((item) => item.role === "assistant");
  return lastAssistant?.id === message.id;
}
