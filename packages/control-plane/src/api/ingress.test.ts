import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "ingress-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-ingress-"));
process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-ingress-settings-"));
process.env.TELEGRAM_BOT_TOKEN = "123:abc";
process.env.TELEGRAM_WEBHOOK_SECRET = "tg-secret";
process.env.WECHAT_TOKEN = "hook-token";
process.env.NOTIFY_DEFAULT_REPO = "fixtures/toy-repo";
delete process.env.CONTROL_PLANE_TOKEN;

const { createApiServer } = await import("./server.js");
const { listen, close } = await import("../e2e/helpers.js");
const { listRuns } = await import("../orchestrator/orchestrator.js");

test("Telegram and WeChat webhooks create runs without login", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;

  const denied = await fetch(`${base}/webhooks/telegram`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { chat: { id: 9 }, text: "nope" } }),
  });
  assert.equal(denied.status, 401);

  const telegram = await fetch(`${base}/webhooks/telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "tg-secret",
    },
    body: JSON.stringify({ message: { chat: { id: 9 }, text: "从 Telegram 过来" } }),
  });
  assert.equal(telegram.status, 202);
  const telegramBody = (await telegram.json()) as { runId?: string };
  assert.ok(telegramBody.runId);
  assert.equal(
    listRuns().some((run) => run.id === telegramBody.runId && run.source === "telegram" && run.notifyChatId === "9"),
    true,
  );

  const timestamp = "1710000000";
  const nonce = "n1";
  const signature = createHash("sha1").update(["hook-token", timestamp, nonce].sort().join("")).digest("hex");
  const echo = await fetch(`${base}/webhooks/wechat?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}&echostr=hello`);
  assert.equal(echo.status, 200);
  assert.equal(await echo.text(), "hello");

  const wechat = await fetch(`${base}/webhooks/wechat?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: "<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[user]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[从微信过来]]></Content></xml>",
  });
  assert.equal(wechat.status, 200);
  const xml = await wechat.text();
  assert.match(xml, /已收到/);
  assert.equal(listRuns().some((run) => run.source === "wechat" && run.prompt === "从微信过来"), true);
});

test("Telegram photo and WeChat image wait for the next text", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
  });
  const base = `http://127.0.0.1:${port}`;
  const before = listRuns().length;

  const photo = await fetch(`${base}/webhooks/telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "tg-secret",
    },
    body: JSON.stringify({ message: { chat: { id: 77 }, photo: [{ file_id: "pic-77" }] } }),
  });
  assert.equal(photo.status, 200);
  assert.deepEqual(await photo.json(), { ok: true, pending: true });
  assert.equal(listRuns().length, before);

  const follow = await fetch(`${base}/webhooks/telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "tg-secret",
    },
    body: JSON.stringify({ message: { chat: { id: 77 }, text: "把 logo 换成这个" } }),
  });
  assert.equal(follow.status, 202);
  assert.equal(
    listRuns().some((run) => run.source === "telegram" && run.prompt.includes("把 logo 换成这个") && run.prompt.includes("图片")),
    true,
  );

  const timestamp = "1710000001";
  const nonce = "n2";
  const signature = createHash("sha1").update(["hook-token", timestamp, nonce].sort().join("")).digest("hex");
  const image = await fetch(`${base}/webhooks/wechat?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: "<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[pic-user]]></FromUserName><MsgType><![CDATA[image]]></MsgType></xml>",
  });
  assert.equal(image.status, 200);
  assert.match(await image.text(), /再发一句说明/);
  const wechatFollow = await fetch(`${base}/webhooks/wechat?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`, {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: "<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[pic-user]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[海报用这张]]></Content></xml>",
  });
  assert.equal(wechatFollow.status, 200);
  assert.equal(
    listRuns().some((run) => run.source === "wechat" && run.prompt.includes("海报用这张") && run.prompt.includes("图片")),
    true,
  );
});
