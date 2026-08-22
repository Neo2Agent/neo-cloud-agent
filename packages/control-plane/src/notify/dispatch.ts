import type { Run } from "@neo-cloud-agent/contracts";
import { publicAppUrl, readNotifySecrets } from "./settings.js";

const lastSent = new Map<string, number>();
const COALESCE_MS = 15_000;

export type NotifyKind = "idle" | "error";

export function formatRunNotice(run: Pick<Run, "id" | "prompt" | "status" | "errorMessage">, kind: NotifyKind): string {
  const title = run.prompt.replace(/\s+/g, " ").trim().slice(0, 80) || run.id.slice(0, 8);
  const status = kind === "error" ? `失败${run.errorMessage ? `：${run.errorMessage.slice(0, 120)}` : ""}` : "做完了";
  const url = publicAppUrl() ? `${publicAppUrl()}/#/runs/${run.id}` : "";
  return [`对话${status}`, title, url].filter(Boolean).join("\n");
}

export async function notifyRunFinished(run: Run, kind: NotifyKind): Promise<number> {
  const now = Date.now();
  const prev = lastSent.get(run.id) ?? 0;
  if (now - prev < COALESCE_MS) {
    return 0;
  }
  lastSent.set(run.id, now);
  const text = formatRunNotice(run, kind);
  return sendNotifyText(text, { runId: run.id, status: run.status, kind, prompt: run.prompt });
}

export async function sendNotifyText(
  text: string,
  extra?: Record<string, unknown>,
): Promise<number> {
  const secrets = readNotifySecrets();
  const jobs: Array<Promise<void>> = [];
  if (secrets.telegramBotToken && secrets.telegramChatId) {
    jobs.push(postTelegram(secrets.telegramBotToken, secrets.telegramChatId, text));
  }
  if (secrets.wecomWebhook) {
    jobs.push(postJson(secrets.wecomWebhook, { msgtype: "text", text: { content: text } }));
  }
  if (secrets.httpUrl) {
    jobs.push(postJson(secrets.httpUrl, { text, ...extra }));
  }
  const results = await Promise.allSettled(jobs);
  return results.filter((item) => item.status === "fulfilled").length;
}

async function postTelegram(token: string, chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) {
    throw new Error(`telegram ${response.status}`);
  }
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`notify ${response.status}`);
  }
}

export function resetNotifyCoalesceForTests(): void {
  lastSent.clear();
}
