import type { ImageRef } from "@neo-cloud-agent/contracts";
import { createRun } from "../orchestrator/orchestrator.js";
import { QuotaError } from "../quota/quota.js";
import { startTelegramLive } from "../notify/telegram-live.js";
import { readNotifySecrets } from "../notify/settings.js";
import {
  downloadTelegramFile,
  parseTelegramUpdate,
  rememberChat,
  verifyTelegramSecret,
} from "../notify/telegram.js";
import { parseWeChatXml, verifyWeChatSignature, weChatTextReply } from "../notify/wechat.js";
import { pendingKey, rememberPendingIngress, takePendingIngress } from "./pending.js";

export async function ingestTelegramWebhook(input: {
  secretHeader?: string | string[];
  payload: unknown;
}): Promise<{ status: number; body: unknown }> {
  const secrets = readNotifySecrets();
  if (!secrets.telegramBotToken) {
    return { status: 503, body: { error: "telegram_not_configured" } };
  }
  if (!verifyTelegramSecret(input.secretHeader, secrets.telegramWebhookSecret)) {
    return { status: 401, body: { error: "invalid_secret" } };
  }
  const ingress = parseTelegramUpdate(input.payload);
  if (ingress.chatId) rememberChat(ingress.chatId);
  if (ingress.ignored) {
    return { status: 200, body: { ok: true, ignored: true } };
  }
  const key = pendingKey("telegram", ingress.chatId);
  const liveImage = ingress.photoFileId
    ? await downloadTelegramFile(secrets.telegramBotToken, ingress.photoFileId).catch(() => null)
    : null;
  if (!ingress.text && (ingress.photoFileId || ingress.documentFileId)) {
    rememberPendingIngress(key, {
      kind: ingress.photoFileId ? "image" : "file",
      label: ingress.photoFileId ? "图片" : "文件",
      image: liveImage ?? undefined,
    });
    return { status: 200, body: { ok: true, pending: true } };
  }
  const pending = takePendingIngress(key);
  const prompt = pending ? `用户先发了${pending.label}，说明如下：\n${ingress.text}` : ingress.text;
  const images = [pending?.image, liveImage].filter((item): item is ImageRef => Boolean(item));
  try {
    const run = await createRun({
      prompt,
      repoUrls: secrets.defaultRepo ? [secrets.defaultRepo] : [],
      source: "telegram",
      notifyChatId: ingress.chatId,
      images: images.length ? images : undefined,
    });
    void startTelegramLive(run.id, ingress.chatId);
    return { status: 202, body: { ok: true, runId: run.id } };
  } catch (error) {
    if (error instanceof QuotaError) {
      return { status: 429, body: { error: error.message } };
    }
    throw error;
  }
}

export function verifyWeChatQuery(query: URLSearchParams): { ok: boolean; echo?: string } {
  const secrets = readNotifySecrets();
  if (!secrets.wechatToken) return { ok: false };
  const timestamp = query.get("timestamp") ?? "";
  const nonce = query.get("nonce") ?? "";
  const signature = query.get("signature") ?? "";
  if (!verifyWeChatSignature({ token: secrets.wechatToken, timestamp, nonce, signature })) {
    return { ok: false };
  }
  return { ok: true, echo: query.get("echostr") ?? "" };
}

export async function ingestWeChatXml(xml: string): Promise<{ status: number; xml: string }> {
  const secrets = readNotifySecrets();
  const message = parseWeChatXml(xml);
  const key = pendingKey("wechat", message.fromUser || message.toUser);
  if (message.msgType === "image" || message.picUrl) {
    const image = message.picUrl ? await downloadPublicImage(message.picUrl).catch(() => null) : null;
    rememberPendingIngress(key, {
      kind: "image",
      label: "图片",
      image: image ?? undefined,
    });
    return {
      status: 200,
      xml: weChatTextReply(message.fromUser, message.toUser, "收到图片。再发一句说明，我就开始做。"),
    };
  }
  if (message.msgType !== "text" || !message.content) {
    return {
      status: 200,
      xml: weChatTextReply(message.fromUser, message.toUser, "发文字任务给我，例如：帮我看一下这段报错"),
    };
  }
  const pending = takePendingIngress(key);
  const prompt = pending ? `用户先发了${pending.label}，说明如下：\n${message.content}` : message.content;
  const images = pending?.image ? [pending.image] : [];
  let run;
  try {
    run = await createRun({
      prompt,
      repoUrls: secrets.defaultRepo ? [secrets.defaultRepo] : [],
      source: "wechat",
      images: images.length ? images : undefined,
    });
  } catch (error) {
    if (error instanceof QuotaError) {
      return {
        status: 200,
        xml: weChatTextReply(message.fromUser, message.toUser, "额度用完了，稍后再试。"),
      };
    }
    throw error;
  }
  return {
    status: 200,
    xml: weChatTextReply(message.fromUser, message.toUser, `已收到，正在做。对话 ${run.id.slice(0, 8)}`),
  };
}

async function downloadPublicImage(url: string): Promise<ImageRef | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const mediaType = (response.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mediaType.startsWith("image/")) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > 1_500_000) return null;
  return { mediaType, data: buffer.toString("base64") };
}
