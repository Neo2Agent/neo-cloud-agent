import type { TranscriptMessage } from "./events.js";

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

const MAX_TURNS = 24;
const MAX_CHARS = 24_000;
const MAX_TURN_CHARS = 2_000;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

/** Prior user/assistant bubbles, dropping a trailing unanswered user turn. */
export function priorConversationTurns(messages: TranscriptMessage[]): ConversationTurn[] {
  const turns = messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.text.trim())
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: message.text.trim(),
    }));
  if (turns.at(-1)?.role === "user") {
    turns.pop();
  }
  return turns;
}

export function formatConversationReplay(turns: ConversationTurn[]): string {
  if (turns.length === 0) {
    return "";
  }
  const selected = turns.slice(-MAX_TURNS);
  const render = (items: ConversationTurn[]) =>
    items.map((turn) => `${turn.role === "user" ? "用户" : "助手"}：${clip(turn.text, MAX_TURN_CHARS)}`).join("\n\n");
  while (selected.length > 2 && render(selected).length > MAX_CHARS) {
    selected.shift();
  }
  let body = render(selected);
  if (body.length > MAX_CHARS) {
    body = `…${body.slice(-(MAX_CHARS - 1))}`;
  }
  return [
    "【系统】工作进程已重启。下面是本对话此前的记录。请当作你已经参与过这些回合，直接接着回答，不要声称这是新会话，也不要靠翻 sessions 目录来寻找记忆。",
    "",
    body,
  ].join("\n");
}

export function wrapPromptWithConversationReplay(text: string, replay: string): string {
  const trimmed = replay.trim();
  if (!trimmed) {
    return text;
  }
  return `${trimmed}\n\n【用户继续】\n${text}`;
}

export function conversationReplayFromMessages(messages: TranscriptMessage[]): string {
  return formatConversationReplay(priorConversationTurns(messages));
}
