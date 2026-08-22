import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveLlmSettingsRoot } from "@neo-cloud-agent/contracts";
import { randomBytes } from "node:crypto";

export const TELEGRAM_WEBHOOK_PATH = "/webhooks/telegram";
export const WECHAT_WEBHOOK_PATH = "/webhooks/wechat";

const FILE_NAME = path.join(".neo", "notify.env");

export type NotifyWriteInput = {
  telegramBotToken?: string;
  telegramChatId?: string;
  wecomWebhook?: string;
  httpUrl?: string;
  wechatToken?: string;
  defaultRepo?: string;
  clear?: boolean;
};

export type PublicNotifySettings = {
  telegram: { configured: boolean; path: string; chatIdSet: boolean };
  wecom: { configured: boolean };
  http: { configured: boolean };
  wechat: { configured: boolean; path: string };
  defaultRepo: string;
  publicAppUrl: string;
};

function notifyFile(root = resolveLlmSettingsRoot()): string {
  return path.join(root, FILE_NAME);
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function readStored(): Record<string, string> {
  try {
    return parseEnv(readFileSync(notifyFile(), "utf8"));
  } catch {
    return {};
  }
}

export function publicAppUrl(): string {
  return (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
}

export function readNotifySecrets(): {
  telegramBotToken: string;
  telegramChatId: string;
  telegramWebhookSecret: string;
  wecomWebhook: string;
  httpUrl: string;
  wechatToken: string;
  defaultRepo: string;
} {
  const stored = readStored();
  return {
    telegramBotToken: (process.env.TELEGRAM_BOT_TOKEN ?? stored.TELEGRAM_BOT_TOKEN ?? "").trim(),
    telegramChatId: (process.env.TELEGRAM_CHAT_ID ?? stored.TELEGRAM_CHAT_ID ?? "").trim(),
    telegramWebhookSecret: (process.env.TELEGRAM_WEBHOOK_SECRET ?? stored.TELEGRAM_WEBHOOK_SECRET ?? "").trim(),
    wecomWebhook: (process.env.WECOM_WEBHOOK_URL ?? stored.WECOM_WEBHOOK_URL ?? "").trim(),
    httpUrl: (process.env.NOTIFY_HTTP_URL ?? stored.NOTIFY_HTTP_URL ?? "").trim(),
    wechatToken: (process.env.WECHAT_TOKEN ?? stored.WECHAT_TOKEN ?? "").trim(),
    defaultRepo: (process.env.NOTIFY_DEFAULT_REPO ?? stored.NOTIFY_DEFAULT_REPO ?? "").trim(),
  };
}

function writeEnv(values: Record<string, string>): void {
  const file = notifyFile();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lines = ["# Written by Neo Cloud Agent. Do not commit."];
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    if (/[\r\n]/.test(value)) throw new Error(`${key} must be a single line`);
    lines.push(`${key}=${value}`);
  }
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function rememberTelegramChatId(chatId: string): void {
  const id = chatId.trim();
  if (!id) return;
  const current = readNotifySecrets();
  if (current.telegramChatId) return;
  writeNotifySettings({ telegramChatId: id });
}

export function writeNotifySettings(input: NotifyWriteInput): PublicNotifySettings {
  if (input.clear) {
    try {
      if (existsSync(notifyFile())) unlinkSync(notifyFile());
    } catch {
      // ignore
    }
    return publicNotifySettings();
  }
  const current = readNotifySecrets();
  const next = {
    TELEGRAM_BOT_TOKEN: (input.telegramBotToken ?? current.telegramBotToken).trim(),
    TELEGRAM_CHAT_ID: (input.telegramChatId ?? current.telegramChatId).trim(),
    TELEGRAM_WEBHOOK_SECRET: current.telegramWebhookSecret || randomBytes(16).toString("hex"),
    WECOM_WEBHOOK_URL: (input.wecomWebhook ?? current.wecomWebhook).trim(),
    NOTIFY_HTTP_URL: (input.httpUrl ?? current.httpUrl).trim(),
    WECHAT_TOKEN: (input.wechatToken ?? current.wechatToken).trim(),
    NOTIFY_DEFAULT_REPO: (input.defaultRepo ?? current.defaultRepo).trim(),
  };
  if (input.telegramBotToken === "") next.TELEGRAM_BOT_TOKEN = "";
  if (input.wecomWebhook === "") next.WECOM_WEBHOOK_URL = "";
  if (input.httpUrl === "") next.NOTIFY_HTTP_URL = "";
  if (input.wechatToken === "") next.WECHAT_TOKEN = "";
  writeEnv(next);
  return publicNotifySettings();
}

export function publicNotifySettings(): PublicNotifySettings {
  const secrets = readNotifySecrets();
  return {
    telegram: {
      configured: Boolean(secrets.telegramBotToken),
      path: TELEGRAM_WEBHOOK_PATH,
      chatIdSet: Boolean(secrets.telegramChatId),
    },
    wecom: { configured: Boolean(secrets.wecomWebhook) },
    http: { configured: Boolean(secrets.httpUrl) },
    wechat: { configured: Boolean(secrets.wechatToken), path: WECHAT_WEBHOOK_PATH },
    defaultRepo: secrets.defaultRepo,
    publicAppUrl: publicAppUrl(),
  };
}
