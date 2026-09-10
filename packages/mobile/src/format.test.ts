import assert from "node:assert/strict";
import test from "node:test";
import { avatarLetter, CHAT_MODELS, chatModelLabel, chatModelShort, resolveChatModel, toolBodyText } from "./format.js";

test("mobile chat models are DeepSeek Flash 4.1 only", () => {
  assert.deepEqual(
    CHAT_MODELS.map((item) => item.id),
    ["deepseek-flash"],
  );
  assert.equal(chatModelLabel("deepseek-flash"), "DeepSeek Flash 4.1");
  assert.equal(chatModelLabel("deepseek-v4-pro"), "DeepSeek Flash 4.1");
  assert.equal(chatModelShort("deepseek-v4-pro"), "Flash");
  assert.equal(resolveChatModel("deepseek-v4-flash-vision-exp"), "deepseek-flash");
});

test("avatarLetter uses the account initial", () => {
  assert.equal(avatarLetter("admin@neorun.cloud"), "A");
  assert.equal(avatarLetter("ping"), "P");
  assert.equal(avatarLetter(""), "我");
});

test("toolBodyText shows output or a running placeholder", () => {
  assert.equal(toolBodyText({ output: "  wrote file  " }), "wrote file");
  assert.equal(toolBodyText({ status: "running" }), "执行中…");
  assert.equal(toolBodyText({ status: "done" }), "");
});
