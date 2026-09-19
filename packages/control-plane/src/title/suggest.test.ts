import assert from "node:assert/strict";
import test from "node:test";
import { setSuggestFetchForTests, suggestRunTitle, TitleSuggestError } from "./suggest.js";

const input = {
  prompt: "帮我把首页改成深色，并加上登录按钮",
  model: "neo/deepseek",
  jwt: "run.jwt",
  gatewayUrl: "http://gw.test",
};

test("suggestRunTitle posts a non-stream completion and keeps the first line", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  setSuggestFetchForTests(async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "首页深色改版\n不要这一行" } }] }),
      { status: 200 },
    );
  });
  try {
    assert.equal(await suggestRunTitle(input), "首页深色改版");
    assert.equal(calls[0]?.url, "http://gw.test/v1/chat/completions");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer run.jwt");
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      stream: boolean;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 64);
    assert.equal(body.messages[0]?.role, "system");
    assert.match(body.messages[1]?.content ?? "", /首页/);
    assert.doesNotMatch(JSON.stringify(calls[0]?.init?.body), /obj:/);
  } finally {
    setSuggestFetchForTests(null);
  }
});

test("suggestRunTitle falls back when the gateway is mock or empty", async () => {
  setSuggestFetchForTests(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Mock gateway response. Save a DeepSeek or OpenAI API key on the chat page.",
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  try {
    assert.equal(await suggestRunTitle(input), "帮我把首页改成深色，并加上登录按钮");
  } finally {
    setSuggestFetchForTests(null);
  }
});

test("suggestRunTitle fails closed on a bad gateway status", async () => {
  setSuggestFetchForTests(async () => new Response("nope", { status: 503 }));
  try {
    await assert.rejects(() => suggestRunTitle(input), TitleSuggestError);
  } finally {
    setSuggestFetchForTests(null);
  }
});
