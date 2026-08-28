import type { PullRequestRef, Run } from "@neo-cloud-agent/contracts";
import { isExpoPushToken, listStoredDevices } from "../devices/store.js";
import { formatExpoPushMessage, sendExpoPush } from "./expo.js";
import { publicAppUrl, readNotifySecrets } from "./settings.js";
import { sendSmtpMail } from "./smtp.js";
import { sendTelegramMessage } from "./telegram.js";

const lastSent = new Map<string, number>();
const COALESCE_MS = 15_000;

export type NotifyKind = "idle" | "error" | "pr";

type NoticeRun = Pick<Run, "id" | "prompt" | "status" | "errorMessage"> & {
  pullRequests?: PullRequestRef[];
  notifyChatId?: string | null;
};

function promptTitle(run: Pick<Run, "id" | "prompt">): string {
  return run.prompt.replace(/\s+/g, " ").trim().slice(0, 80) || run.id.slice(0, 8);
}

function chatUrl(runId: string): string {
  return publicAppUrl() ? `${publicAppUrl()}/#/runs/${runId}` : "";
}

function prLines(run: NoticeRun): string[] {
  return (run.pullRequests ?? []).map((item) => item.url).filter(Boolean);
}

export function formatRunNotice(run: NoticeRun, kind: NotifyKind): string {
  const status =
    kind === "error"
      ? `失败${run.errorMessage ? `：${run.errorMessage.slice(0, 120)}` : ""}`
      : kind === "pr"
        ? "PR 开好了"
        : "做完了";
  return [`对话${status}`, promptTitle(run), ...prLines(run), chatUrl(run.id)].filter(Boolean).join("\n");
}

export function formatPrReadyNotice(run: NoticeRun): string {
  return formatRunNotice(run, "pr");
}

export async function notifyRunFinished(run: Run, kind: Exclude<NotifyKind, "pr">): Promise<number> {
  return notifyKeyed(`${run.id}:${kind}`, formatRunNotice(run, kind), {
    runId: run.id,
    userId: run.userId,
    status: run.status,
    kind,
    prompt: run.prompt,
    chatId: run.notifyChatId ?? undefined,
  });
}

export async function notifyPrReady(run: Run): Promise<number> {
  return notifyKeyed(`${run.id}:pr`, formatPrReadyNotice(run), {
    runId: run.id,
    userId: run.userId,
    status: run.status,
    kind: "pr",
    prompt: run.prompt,
    chatId: run.notifyChatId ?? undefined,
    pullRequest: run.pullRequests.at(-1)?.url,
  });
}

async function notifyKeyed(
  key: string,
  text: string,
  extra: Record<string, unknown> & { chatId?: string; userId?: string; runId?: string; kind?: NotifyKind },
): Promise<number> {
  const now = Date.now();
  const prev = lastSent.get(key) ?? 0;
  if (now - prev < COALESCE_MS) {
    return 0;
  }
  lastSent.set(key, now);
  return sendNotifyText(text, extra);
}

export async function sendNotifyText(
  text: string,
  extra?: Record<string, unknown> & { chatId?: string; userId?: string; runId?: string; kind?: NotifyKind },
): Promise<number> {
  const secrets = readNotifySecrets();
  const jobs: Array<Promise<void>> = [];
  const chatId = (typeof extra?.chatId === "string" && extra.chatId.trim()) || secrets.telegramChatId;
  const userId = typeof extra?.userId === "string" ? extra.userId : "";
  if (userId && extra?.runId && extra.kind) {
    jobs.push(postExpoDevices(userId, text, extra.runId, extra.kind));
  }
  if (secrets.telegramBotToken && chatId) {
    jobs.push(postTelegram(secrets.telegramBotToken, chatId, text));
  }
  if (secrets.wecomWebhook) {
    jobs.push(postJson(secrets.wecomWebhook, { msgtype: "text", text: { content: text } }));
  }
  if (secrets.httpUrl) {
    jobs.push(postJson(secrets.httpUrl, { text, ...extra }));
  }
  if (secrets.smtpHost && secrets.emailTo) {
    jobs.push(
      sendSmtpMail({
        host: secrets.smtpHost,
        port: secrets.smtpPort,
        user: secrets.smtpUser,
        pass: secrets.smtpPass,
        from: secrets.smtpFrom || secrets.smtpUser || secrets.emailTo,
        to: secrets.emailTo,
        subject: text.split("\n")[0] || "Neo Cloud Agent",
        text,
      }),
    );
  }
  const results = await Promise.allSettled(jobs);
  return results.filter((item) => item.status === "fulfilled").length;
}

async function postTelegram(token: string, chatId: string, text: string): Promise<void> {
  await sendTelegramMessage(token, chatId, text);
}

async function postExpoDevices(userId: string, text: string, runId: string, kind: NotifyKind): Promise<void> {
  const tokens = listStoredDevices(userId)
    .map((item) => item.pushToken)
    .filter(isExpoPushToken);
  if (tokens.length === 0) {
    return;
  }
  const lines = text.split("\n").filter(Boolean);
  const title = lines[0] || "Neo Cloud Agent";
  const body = lines.slice(1).join("\n") || title;
  const url = chatUrl(runId) || `neo://runs/${runId}`;
  await sendExpoPush(tokens.map((token) => formatExpoPushMessage({ token, title, body, runId, kind, url })));
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
