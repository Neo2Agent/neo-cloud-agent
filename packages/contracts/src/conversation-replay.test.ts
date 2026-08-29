import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptMessage } from "./events.js";
import {
  conversationReplayFromMessages,
  formatConversationReplay,
  priorConversationTurns,
  wrapPromptWithConversationReplay,
} from "./conversation-replay.js";

function message(role: TranscriptMessage["role"], text: string, id = text): TranscriptMessage {
  return {
    id,
    role,
    text,
    createdAt: "2026-08-29T12:00:00.000Z",
  };
}

test("prior turns drop a trailing unanswered user message", () => {
  assert.deepEqual(
    priorConversationTurns([
      message("user", "郑州天气"),
      message("assistant", "明天 23–27°C"),
      message("user", "我们刚才聊了什么"),
    ]),
    [
      { role: "user", text: "郑州天气" },
      { role: "assistant", text: "明天 23–27°C" },
    ],
  );
});

test("prior turns ignore setup bubbles and empty text", () => {
  assert.deepEqual(
    priorConversationTurns([
      message("setup", "Provisioning worker"),
      message("user", "  "),
      message("user", "hello"),
      message("assistant", "hi"),
    ]),
    [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
    ],
  );
});

test("replay is empty when the run has no completed turn yet", () => {
  assert.equal(conversationReplayFromMessages([message("user", "first prompt")]), "");
});

test("replay tells the model this is the same conversation", () => {
  const replay = formatConversationReplay([
    { role: "user", text: "郑州明天天气" },
    { role: "assistant", text: "23–27°C，多云" },
  ]);
  assert.match(replay, /工作进程已重启/);
  assert.match(replay, /用户：郑州明天天气/);
  assert.match(replay, /助手：23–27°C，多云/);
  assert.match(replay, /不要声称这是新会话/);
});

test("wrap keeps the new user text after the recovered history", () => {
  assert.equal(
    wrapPromptWithConversationReplay("我们刚才聊了什么", "history"),
    "history\n\n【用户继续】\n我们刚才聊了什么",
  );
  assert.equal(wrapPromptWithConversationReplay("keep", "  "), "keep");
});
