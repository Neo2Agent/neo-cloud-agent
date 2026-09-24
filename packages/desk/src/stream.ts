import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { assistantIsLive, runningToolName } from "@neo-cloud-agent/contracts/turn-state";

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
