import { formatDuration, formatWhen, sameClockMinute } from "./display.js";
import type { TranscriptMessage } from "./events.js";
import { currentTurnMessages } from "./turn-state.js";

/** Text, a tool row, or a text block. An empty shell from `message.start` does not count. */
export function hasVisibleAssistantContent(message: TranscriptMessage): boolean {
  if (message.text.trim()) return true;
  if (message.tools?.length) return true;
  return Boolean(message.blocks?.some((block) => (block.type === "tool" ? true : Boolean(block.text.trim()))));
}

/** "正在思考" only before this turn has anything to show. The work fold owns the spinner after that. */
export function shouldShowThinking(busy: boolean, messages: TranscriptMessage[]): boolean {
  if (!busy) return false;
  return !currentTurnMessages(messages).some(
    (message) => message.role === "assistant" && hasVisibleAssistantContent(message),
  );
}

/**
 * The sender to print on a user bubble, only when it is someone other than the viewer.
 * Shared runs mix messages from several people; the viewer's own stay unlabeled.
 */
export function userMessageAuthor(
  message: Pick<TranscriptMessage, "actorUserId" | "actorEmail">,
  viewer: { id?: string | null; email?: string | null },
): string | null {
  const email = message.actorEmail?.trim() ?? "";
  if (!email) return null;
  if (viewer.id && message.actorUserId === viewer.id) return null;
  if (viewer.email && email.toLowerCase() === viewer.email.trim().toLowerCase()) return null;
  return email;
}

/** "正在回复" only once reply text is visible. */
export function isAssistantStreaming(messages: TranscriptMessage[]): boolean {
  return currentTurnMessages(messages).some(
    (message) => message.role === "assistant" && message.streaming && Boolean(message.text.trim()),
  );
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

/** `8/24 17:30`, plus `· 完成 …` when the reply finished in a later minute. */
export function formatMessageTime(createdAt: string, updatedAt?: string | null, now = new Date()): string {
  const created = formatWhen(createdAt, now);
  if (!updatedAt || sameClockMinute(createdAt, updatedAt)) {
    return created;
  }
  return `${created} · 完成 ${formatWhen(updatedAt, now)}`;
}

/**
 * Footer time for a message. A live assistant turn shows none; a settled one shows when it ran and,
 * unless a work fold already shows the duration, how long it took.
 */
export function messageTimeLabel(
  message: Pick<TranscriptMessage, "role" | "createdAt" | "updatedAt">,
  opts: { live?: boolean; withDuration?: boolean; now?: Date } = {},
): string | null {
  if (message.role === "assistant" && opts.live) return null;
  const when = formatMessageTime(message.createdAt, message.updatedAt, opts.now);
  const duration =
    message.role === "assistant" && opts.withDuration !== false
      ? formatDuration(message.createdAt, message.updatedAt, opts.now)
      : "";
  return duration ? `${when} · ${duration}` : when;
}
