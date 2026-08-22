import { timingSafeEqual } from "node:crypto";
import { publicAppUrl, readNotifySecrets, rememberTelegramChatId } from "./settings.js";

export type TelegramIngress = {
  chatId: string;
  text: string;
  ignored?: boolean;
};

export function verifyTelegramSecret(header: string | string[] | undefined, secret: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!secret) return true;
  if (!value) return false;
  const left = Buffer.from(secret);
  const right = Buffer.from(value);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseTelegramUpdate(payload: unknown): TelegramIngress {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const message = asRecord(body.message) ?? asRecord(body.edited_message);
  const chat = asRecord(message?.chat);
  const chatId = String(chat?.id ?? "");
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (!chatId || !text || text.startsWith("/")) {
    return { chatId, text, ignored: true };
  }
  return { chatId, text };
}

export async function registerTelegramWebhook(): Promise<{ ok: boolean; error?: string }> {
  const secrets = readNotifySecrets();
  const app = publicAppUrl();
  if (!secrets.telegramBotToken || !app) {
    return { ok: false, error: "telegram_not_ready" };
  }
  const url = `${app}/webhooks/telegram`;
  const response = await fetch(`https://api.telegram.org/bot${secrets.telegramBotToken}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secrets.telegramWebhookSecret || undefined,
      drop_pending_updates: false,
    }),
  });
  if (!response.ok) {
    return { ok: false, error: `telegram_webhook_${response.status}` };
  }
  return { ok: true };
}

export function rememberChat(chatId: string): void {
  rememberTelegramChatId(chatId);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
