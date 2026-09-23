import type { RunEvent, TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { assistantIsLive, runningToolName } from "@neo-cloud-agent/contracts/turn-state";

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

export function liveActivityLabel(messages: TranscriptMessage[]): string | null {
  const tool = runningToolName(messages);
  if (tool) return `正在执行 ${tool}…`;
  const streaming = [...messages].reverse().find((message) => message.role === "assistant" && message.streaming);
  if (streaming && !streaming.text.trim()) return "正在回复…";
  return null;
}

/** Dots while the turn is open and nothing is visibly streaming or running. Desk has no work fold. */
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
  return messages.some(assistantIsLive) || Boolean(liveActivityLabel(messages));
}

/** One thumbs/copy bar, only after the whole turn is idle, on the last assistant message. */
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
