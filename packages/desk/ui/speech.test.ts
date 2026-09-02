import assert from "node:assert/strict";
import test from "node:test";
import { applyClickVoice, finishClickVoice, startDeskVoice } from "./speech.js";

test("finishClickVoice trims spoken text and never invents a send", () => {
  assert.equal(finishClickVoice("  你好你可以做什么  "), "你好你可以做什么");
  assert.equal(finishClickVoice("\n"), "");
});

test("applyClickVoice fills the prompt only after stop", () => {
  assert.equal(applyClickVoice("", "  看下天气  "), "看下天气");
  assert.equal(applyClickVoice("先看 CI", "再开 PR"), "先看 CI 再开 PR");
});

test("startDeskVoice reports missing iFlytek config without opening the mic", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ configured: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const result = await startDeskVoice("tok", () => undefined);
    assert.equal(result.kind, "error");
    if (result.kind !== "error") throw new Error("expected error");
    assert.match(result.message, /听写未配置/);
  } finally {
    globalThis.fetch = prev;
  }
});
