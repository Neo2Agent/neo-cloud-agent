import assert from "node:assert/strict";
import test from "node:test";
import { applyClickVoice, finishClickVoice, startWebVoice } from "./speech.js";

test("finishClickVoice trims spoken text and never invents a send", () => {
  assert.equal(finishClickVoice("  你好你可以做什么  "), "你好你可以做什么");
  assert.equal(finishClickVoice("\n"), "");
});

test("applyClickVoice fills the prompt only after stop", () => {
  assert.equal(applyClickVoice("", "  看下天气  "), "看下天气");
  assert.equal(applyClickVoice("先看 CI", "再开 PR"), "先看 CI 再开 PR");
});

test("startWebVoice transcribes a picked file when the page has no live mic", async () => {
  const prev = globalThis.fetch;
  const posts: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body ?? "{}")));
      return new Response(JSON.stringify({ sessionId: "s1", text: posts.length > 1 ? "看下天气" : "看下" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ configured: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await startWebVoice("tok", () => undefined, undefined, undefined, {
      allowLiveMic: false,
      pickFile: async () => new File([Uint8Array.from([1])], "a.wav"),
      decodeFile: async () => Uint8Array.from([1, 0, 2, 0]),
    });
    assert.equal(result.kind, "transcript");
    if (result.kind !== "transcript") throw new Error("expected transcript");
    assert.equal(result.text, "看下天气");
  } finally {
    globalThis.fetch = prev;
  }
});

test("startWebVoice opens the file picker before awaiting speech status", async () => {
  const order: string[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async () => {
    order.push("status");
    return new Response(JSON.stringify({ configured: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await startWebVoice("tok", () => undefined, undefined, undefined, {
      allowLiveMic: false,
      pickFile: async () => {
        order.push("pick");
        return null;
      },
      decodeFile: async () => new Uint8Array(),
    });
    assert.equal(result.kind, "cancelled");
    assert.deepEqual(order, ["pick", "status"]);
  } finally {
    globalThis.fetch = prev;
  }
});

test("startWebVoice reports missing iFlytek config without opening the mic", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ configured: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const result = await startWebVoice("tok", () => undefined);
    assert.equal(result.kind, "error");
    if (result.kind !== "error") throw new Error("expected error");
    assert.match(result.message, /听写未配置/);
  } finally {
    globalThis.fetch = prev;
  }
});
