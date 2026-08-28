import type { RunEvent } from "@neo-cloud-agent/contracts";
import { subscribe } from "../events/bus.js";
import { readNotifySecrets } from "./settings.js";
import { editTelegramMessage, sendTelegramMessage } from "./telegram.js";

const live = new Map<string, { chatId: string; messageId: number; lastEdit: number; text: string }>();
const EDIT_MS = 1500;

export async function startTelegramLive(runId: string, chatId: string): Promise<void> {
  const token = readNotifySecrets().telegramBotToken;
  if (!token || !chatId) return;
  let messageId: number | null = null;
  try {
    messageId = await sendTelegramMessage(token, chatId, "已收到，正在做…");
  } catch {
    return;
  }
  if (!messageId) return;
  live.set(runId, { chatId, messageId, lastEdit: Date.now(), text: "已收到，正在做…" });
  const off = subscribe(runId, (event) => {
    void onLiveEvent(token, runId, event, off);
  });
}

export function resetTelegramLiveForTests(): void {
  live.clear();
}

async function onLiveEvent(
  token: string,
  runId: string,
  event: RunEvent,
  off: () => void,
): Promise<void> {
  const state = live.get(runId);
  if (!state) {
    off();
    return;
  }
  if (event.kind === "run.idle" || event.kind === "run.error" || event.kind === "run.archived") {
    off();
    live.delete(runId);
    return;
  }
  const next = liveText(event, state.text);
  if (!next || next === state.text) return;
  const now = Date.now();
  if (now - state.lastEdit < EDIT_MS && event.kind === "message.delta") return;
  state.text = next;
  state.lastEdit = now;
  await editTelegramMessage(token, state.chatId, state.messageId, next).catch(() => undefined);
}

function liveText(event: RunEvent, previous: string): string {
  if (event.kind === "message.delta") {
    const delta = typeof event.data?.delta === "string" ? event.data.delta : "";
    const combined = `${previous === "已收到，正在做…" ? "" : previous}${delta}`.trim();
    return combined.slice(0, 3500);
  }
  if (event.kind === "tool.start") {
    return `正在执行：${event.title || "工具"}`.slice(0, 3500);
  }
  if (event.kind === "message.end" && previous && previous !== "已收到，正在做…") {
    return previous;
  }
  return "";
}
