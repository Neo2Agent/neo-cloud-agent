import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { ImageRef } from "@neo-cloud-agent/contracts/run";
import { STATUS_LABELS } from "./format";

export const ACTIVE_RUN_STATUSES = [
  "NOT_YET_STARTED",
  "PROVISIONING",
  "INSTALLING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
] as const;

const SETUP_STATUSES = new Set(["NOT_YET_STARTED", "PROVISIONING", "INSTALLING"]);
const TERMINAL_EVENT_KINDS = new Set(["run.idle", "run.error", "run.archived", "run.deleted"]);

export type PendingUser = {
  id: string;
  text: string;
  images?: ImageRef[];
  createdAt: string;
};

export function isActiveRunStatus(status?: string | null): boolean {
  return Boolean(status && (ACTIVE_RUN_STATUSES as readonly string[]).includes(status));
}

export function isComposerClosed(status?: string | null): boolean {
  return status === "ARCHIVED" || status === "EXPIRED";
}

function currentTurnMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  let lastUser = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      lastUser = index;
    }
  }
  return lastUser >= 0 ? messages.slice(lastUser + 1) : messages;
}

export function hasLiveAssistantWork(messages: TranscriptMessage[]): boolean {
  return currentTurnMessages(messages).some((message) => {
    if (message.role !== "assistant") return false;
    if (message.streaming && message.text.trim()) return true;
    return Boolean(message.tools?.some((tool) => tool.status === "running"));
  });
}

export function isAssistantStreaming(messages: TranscriptMessage[]): boolean {
  return currentTurnMessages(messages).some(
    (message) => message.role === "assistant" && message.streaming && Boolean(message.text.trim()),
  );
}

export function runningToolName(messages: TranscriptMessage[]): string | null {
  const turn = currentTurnMessages(messages);
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const running = turn[index]?.tools?.find((tool) => tool.status === "running");
    if (running?.name) return running.name;
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

export function shouldShowThinking(busy: boolean, messages: TranscriptMessage[]): boolean {
  if (!busy) return false;
  const turn = currentTurnMessages(messages);
  if (hasLiveAssistantWork(turn)) return false;
  return !turn.some((message) => message.role === "assistant" && Boolean(message.text.trim() || message.tools?.length));
}

export function activityLabel(input: {
  sending?: boolean;
  stopping?: boolean;
  status?: string | null;
  streaming?: boolean;
  runningTool?: string | null;
}): string {
  if (input.stopping) return "正在停止…";
  if (input.sending) return "正在发送…";
  if (input.status === "NOT_YET_STARTED") return "排队等待空闲 VM…";
  if (input.status === "PROVISIONING") return "正在准备运行环境…";
  if (input.status === "INSTALLING") return "正在安装环境…";
  if (input.runningTool === "neo_subagent") return "正在执行子代理…";
  if (input.runningTool) return `正在执行 ${input.runningTool}…`;
  if (input.streaming) return "正在回复…";
  if (input.status === "WAITING_FOR_BACKGROUND_WORK") return "后台任务进行中…";
  if (input.status === "RUNNING") return "正在思考…";
  return "进行中…";
}

export function turnStatusLabel(input: { sending?: boolean; stopping?: boolean; status?: string | null }): {
  state: string;
  label: string;
} {
  if (input.stopping) return { state: "RUNNING", label: "正在停止" };
  if (input.sending && !isActiveRunStatus(input.status)) return { state: "RUNNING", label: "发送中" };
  const status = input.status ?? "idle";
  return { state: status, label: STATUS_LABELS[status] ?? input.status ?? "就绪" };
}

/** Map a live event onto the run status the chat UI should show. */
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
      if (isComposerClosed(current) || (current && SETUP_STATUSES.has(current)) || current === "RUNNING" || current === "WAITING_FOR_BACKGROUND_WORK") {
        return null;
      }
      return "RUNNING";
    case "run.idle":
      return "IDLE";
    case "agent.end":
      return current === "RUNNING" || current === "WAITING_FOR_BACKGROUND_WORK" ? "IDLE" : null;
    case "run.queued":
      return "NOT_YET_STARTED";
    case "run.archived":
      return "ARCHIVED";
    case "run.deleted":
      return "ARCHIVED";
    case "run.error":
      return "ERROR";
    default:
      return null;
  }
}

export function isTerminalTurnEvent(kind: string): boolean {
  return TERMINAL_EVENT_KINDS.has(kind);
}

export function withPendingUser(messages: TranscriptMessage[], pending: PendingUser | null): TranscriptMessage[] {
  if (!pending) return messages;
  const arrived = messages.some(
    (message) =>
      message.role === "user" &&
      message.text === pending.text &&
      Date.parse(message.createdAt) >= Date.parse(pending.createdAt) - 5000,
  );
  if (arrived) return messages;
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

export function pendingUserArrived(messages: TranscriptMessage[], pending: PendingUser): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      message.text === pending.text &&
      Date.parse(message.createdAt) >= Date.parse(pending.createdAt) - 5000,
  );
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

/** Phone home hides the transcript until a run exists; keep it after send so the bubble is visible. */
export function shouldShowBuddyHome(input: {
  narrow: boolean;
  runId?: string | null;
  loadingTranscript?: boolean;
  pending?: boolean;
  messageCount?: number;
}): boolean {
  return Boolean(
    input.narrow && !input.runId && !input.loadingTranscript && !input.pending && !(input.messageCount ?? 0),
  );
}
