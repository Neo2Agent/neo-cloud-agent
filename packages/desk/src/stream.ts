import type { RunEvent, TranscriptGroup, TranscriptMessage } from "@neo-cloud-agent/contracts/events";

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

/** Thumbs/copy stay on settled text, even while bash cards are still running below. */
export function shouldShowAssistantActions(
  message: TranscriptMessage,
  groups: TranscriptGroup[],
  groupIndex: number,
): boolean {
  if (groups[groupIndex]?.type !== "text") return false;
  const laterText = groups.slice(groupIndex + 1).some((item) => item.type === "text");
  return laterText || !message.streaming;
}
