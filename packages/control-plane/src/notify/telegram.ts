import { timingSafeEqual } from "node:crypto";
import type { ImageRef } from "@neo-cloud-agent/contracts";
import { publicAppUrl, readNotifySecrets, rememberTelegramChatId } from "./settings.js";

export type TelegramIngress = {
  chatId: string;
  text: string;
  ignored?: boolean;
  photoFileId?: string;
  documentFileId?: string;
  caption?: string;
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
  const caption = typeof message?.caption === "string" ? message.caption.trim() : "";
  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const lastPhoto = photos.length > 0 ? asRecord(photos[photos.length - 1]) : null;
  const photoFileId = typeof lastPhoto?.file_id === "string" ? lastPhoto.file_id : "";
  const document = asRecord(message?.document);
  const documentFileId = typeof document?.file_id === "string" ? document.file_id : "";
  const hasMedia = Boolean(photoFileId || documentFileId);
  if (!chatId || (text.startsWith("/") && !hasMedia)) {
    return { chatId, text, ignored: true };
  }
  if (!text && !caption && !hasMedia) {
    return { chatId, text, ignored: true };
  }
  return {
    chatId,
    text: text || caption,
    photoFileId: photoFileId || undefined,
    documentFileId: documentFileId || undefined,
    caption: caption || undefined,
  };
}

export async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<number | null> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900) }),
  });
  if (!response.ok) {
    throw new Error(`telegram ${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as { result?: { message_id?: number } } | null;
  return typeof body?.result?.message_id === "number" ? body.result.message_id : null;
}

export async function editTelegramMessage(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text.slice(0, 3900) }),
  });
  return response.ok;
}

export async function downloadTelegramFile(
  token: string,
  fileId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageRef | null> {
  if (!token || !fileId) return null;
  const metaRes = await fetchImpl(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!metaRes.ok) return null;
  const meta = (await metaRes.json().catch(() => null)) as { result?: { file_path?: string } } | null;
  const filePath = meta?.result?.file_path ?? "";
  if (!filePath) return null;
  const fileRes = await fetchImpl(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) return null;
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  if (buffer.length === 0 || buffer.length > 1_500_000) return null;
  const mediaType = guessImageType(filePath, fileRes.headers.get("content-type"));
  if (!mediaType) return null;
  return { mediaType, data: buffer.toString("base64") };
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

function guessImageType(filePath: string, header: string | null): string | null {
  const raw = (header || "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (raw.startsWith("image/")) return raw;
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
