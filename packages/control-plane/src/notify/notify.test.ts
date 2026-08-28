import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { formatPrReadyNotice, formatRunNotice } from "./dispatch.js";
import { chunkExpoMessages, formatExpoPushMessage } from "./expo.js";
import { smtpAuthPlain } from "./smtp.js";
import { parseTelegramUpdate, verifyTelegramSecret } from "./telegram.js";
import { parseWeChatXml, verifyWeChatSignature, weChatTextReply } from "./wechat.js";

test("formatRunNotice keeps a short Chinese completion message", () => {
  const text = formatRunNotice(
    {
      id: "run-12345678",
      prompt: "帮我看一下这段报错",
      status: "IDLE",
      errorMessage: null,
      pullRequests: [{ repoUrl: "https://github.com/acme/app", branch: "neo/x", url: "https://github.com/acme/app/pull/3", draft: true, number: 3, title: "fix" }],
    },
    "idle",
  );
  assert.match(text, /做完了/);
  assert.match(text, /帮我看一下这段报错/);
  assert.match(text, /github.com\/acme\/app\/pull\/3/);
  assert.match(formatPrReadyNotice({ id: "run-12345678", prompt: "开 PR", status: "RUNNING", errorMessage: null, pullRequests: [{ repoUrl: "https://github.com/acme/app", branch: "neo/x", url: "https://github.com/acme/app/pull/3", draft: true, number: 3, title: "fix" }] }), /PR 开好了/);
  assert.equal(smtpAuthPlain("u", "p"), Buffer.from("\0u\0p").toString("base64"));
});

test("Expo push payload carries run id and deep link data", () => {
  const message = formatExpoPushMessage({
    token: "ExponentPushToken[abc]",
    title: "对话做完了",
    body: "帮我看一下",
    runId: "run-1",
    kind: "idle",
    url: "https://example/#/runs/run-1",
  });
  assert.equal(message.to, "ExponentPushToken[abc]");
  assert.equal(message.data.runId, "run-1");
  assert.equal(message.data.kind, "idle");
  assert.equal(chunkExpoMessages(new Array(101).fill(1)).length, 2);
});

test("Telegram parser ignores slash commands and keeps chat id", () => {
  const ignored = parseTelegramUpdate({ message: { chat: { id: 42 }, text: "/start" } });
  assert.equal(ignored.ignored, true);
  assert.equal(ignored.chatId, "42");
  const work = parseTelegramUpdate({ message: { chat: { id: 42 }, text: "帮我看一下" } });
  assert.equal(work.ignored, undefined);
  assert.equal(work.text, "帮我看一下");
  const photo = parseTelegramUpdate({
    message: { chat: { id: 42 }, photo: [{ file_id: "small" }, { file_id: "big" }] },
  });
  assert.equal(photo.ignored, undefined);
  assert.equal(photo.photoFileId, "big");
  const captioned = parseTelegramUpdate({
    message: { chat: { id: 42 }, caption: "看这张图", photo: [{ file_id: "pic" }] },
  });
  assert.equal(captioned.text, "看这张图");
  assert.equal(captioned.photoFileId, "pic");
  assert.equal(verifyTelegramSecret("abc", "abc"), true);
  assert.equal(verifyTelegramSecret("nope", "abc"), false);
});

test("WeChat signature and XML reply use the official token check", () => {
  const token = "neo-wechat";
  const timestamp = "1710000000";
  const nonce = "abcd";
  const signature = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
  assert.equal(verifyWeChatSignature({ token, timestamp, nonce, signature }), true);
  const parsed = parseWeChatXml(
    "<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[user]]></FromUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[帮我看一下]]></Content></xml>",
  );
  assert.equal(parsed.content, "帮我看一下");
  const image = parseWeChatXml(
    "<xml><ToUserName><![CDATA[gh]]></ToUserName><FromUserName><![CDATA[user]]></FromUserName><MsgType><![CDATA[image]]></MsgType><PicUrl><![CDATA[https://example/a.jpg]]></PicUrl><MediaId><![CDATA[mid]]></MediaId></xml>",
  );
  assert.equal(image.msgType, "image");
  assert.equal(image.picUrl, "https://example/a.jpg");
  assert.equal(image.mediaId, "mid");
  assert.match(weChatTextReply("user", "gh", "已收到"), /已收到/);
});
