import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import { QUEUED_SLOT_NOTICE } from "@neo-cloud-agent/contracts/turn-state";

export function pendingUserMessage(
  text: string,
  now = new Date().toISOString(),
  images?: TranscriptMessage["images"],
): TranscriptMessage {
  return { id: `pending-${now}`, role: "user", text, createdAt: now, images: images?.length ? images : undefined };
}

export const DESK_STARTING_NOTICE = "正在 Desk 上启动 Agent";

const STARTUP_WHISPERS = new Set([
  DESK_STARTING_NOTICE,
  "正在这台电脑上启动 Agent",
  QUEUED_SLOT_NOTICE,
  "已派给 Desk，等待启动",
  "已派给这台电脑，等待启动",
  "等待 Desk 上线",
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

export { shouldShowThinking } from "@neo-cloud-agent/contracts/turn-view";

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
