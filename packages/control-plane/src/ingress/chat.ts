import { createRun } from "../orchestrator/orchestrator.js";
import { readNotifySecrets } from "../notify/settings.js";
import { parseTelegramUpdate, rememberChat, verifyTelegramSecret } from "../notify/telegram.js";
import { parseWeChatXml, verifyWeChatSignature, weChatTextReply } from "../notify/wechat.js";

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
  if (ingress.ignored || !ingress.text) {
    return { status: 200, body: { ok: true, ignored: true } };
  }
  const run = await createRun({
    prompt: ingress.text,
    repoUrls: secrets.defaultRepo ? [secrets.defaultRepo] : [],
    source: "telegram",
  });
  return { status: 202, body: { ok: true, runId: run.id } };
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
  if (message.msgType !== "text" || !message.content) {
    return {
      status: 200,
      xml: weChatTextReply(message.fromUser, message.toUser, "发文字任务给我，例如：帮我看一下这段报错"),
    };
  }
  const run = await createRun({
    prompt: message.content,
    repoUrls: secrets.defaultRepo ? [secrets.defaultRepo] : [],
    source: "wechat",
  });
  return {
    status: 200,
    xml: weChatTextReply(message.fromUser, message.toUser, `已收到，正在做。对话 ${run.id.slice(0, 8)}`),
  };
}
