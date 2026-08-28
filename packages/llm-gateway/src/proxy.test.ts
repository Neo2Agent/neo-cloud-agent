import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mintRunToken } from "@neo-cloud-agent/contracts";
import { buildMockSse, capUpstreamMaxTokens, explainUpstreamChatError, rewriteBody } from "./proxy.js";
import { messagesHaveImages, resolveUpstreamModel } from "./routes.js";
import { createGatewayServer } from "./server.js";

test("rewrites public model ids to the upstream fallback", () => {
  const rewritten = rewriteBody({ model: "neo/sonnet", messages: [] }, "gpt-4o-mini");
  assert.equal(rewritten.model, "gpt-4o-mini");
  assert.equal(resolveUpstreamModel("unknown-model", "gpt-4o-mini"), "gpt-4o-mini");
});

test("caps and always sets max_tokens so New API cannot reserve 384k output", () => {
  const injected = rewriteBody({ model: "deepseek-v4-flash", messages: [] }, "deepseek-v4-flash");
  assert.equal(injected.max_tokens, 16_384);
  const capped = capUpstreamMaxTokens({ model: "deepseek-v4-flash", max_tokens: 384_000 });
  assert.equal(capped.max_tokens, 16_384);
  const kept = capUpstreamMaxTokens({ model: "deepseek-v4-flash", max_tokens: 2048 });
  assert.equal(kept.max_tokens, 2048);
  const both = capUpstreamMaxTokens({ model: "gpt-4o-mini", max_tokens: 99_000, max_completion_tokens: 99_000 });
  assert.equal(both.max_tokens, 16_384);
  assert.equal(both.max_completion_tokens, 16_384);
});

test("explains New API pre-deduct 403s without echoing the raw wallet line", () => {
  const message = explainUpstreamChatError(
    403,
    JSON.stringify({ error: { message: "预扣费额度失败, 用户剩余额度: ＄32.56, 需要预扣费额度: ＄33.35" } }),
  );
  assert.match(message, /额度预扣失败/);
  assert.equal(/＄32/.test(message), false);
  assert.match(explainUpstreamChatError(429, "slow down"), /过于频繁/);
});

test("maps DeepSeek public ids and retired aliases to v4-flash", () => {
  assert.equal(resolveUpstreamModel("neo/deepseek", "deepseek-v4-flash"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("neo/ds", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("ds", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("deepseek", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("deepseek-chat", "gpt-4o-mini"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("deepseek-reasoner", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("deepseek-v4-pro", "deepseek-v4-flash"), "deepseek-v4-pro");
  assert.equal(resolveUpstreamModel("deepseek-v4-flash-vision-exp", "deepseek-v4-flash"), "deepseek-v4-flash-vision-exp");
});

test("rewriteBody upgrades text Flash to vision when messages carry images", () => {
  const textOnly = rewriteBody({ model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }] }, "deepseek-v4-flash");
  assert.equal(textOnly.model, "deepseek-v4-flash");
  const withImage = rewriteBody(
    {
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "see" },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
          ],
        },
      ],
    },
    "deepseek-v4-flash",
  );
  assert.equal(withImage.model, "deepseek-v4-flash-vision-exp");
  assert.equal(
    messagesHaveImages([{ role: "user", content: [{ type: "image", data: "xx" }] }]),
    true,
  );
});

test("mock SSE is OpenAI-compatible", () => {
  const sse = buildMockSse("gpt-4o-mini", "hello");
  assert.match(sse, /data: \{"id":"chatcmpl-/);
  assert.match(sse, /"content":"hello"/);
  assert.match(sse, /data: \[DONE\]/);
});

test("gateway requires a run JWT and can forward to an OpenAI-compatible upstream", async () => {
  const isolated = mkdtempSync(path.join(tmpdir(), "neo-gw-mock-"));
  process.env.LLM_SETTINGS_DIR = isolated;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_UPSTREAM_API_KEY;
  process.env.LLM_GATEWAY_JWT_SECRET = "test-secret";
  process.env.LLM_UPSTREAM = "mock";
  const server = createGatewayServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("no listen port");
  }

  try {
    const url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
    const denied = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "neo/sonnet", messages: [] }),
    });
    assert.equal(denied.status, 401);

    const token = mintRunToken("test-secret", {
      sub: "user",
      runId: "run",
      orgId: "org",
      model: "neo/sonnet",
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: "jti",
    });
    const ok = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "neo/sonnet", messages: [{ role: "user", content: "hi" }] }),
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { choices: Array<{ message: { content: string } }> };
    assert.match(body.choices[0]?.message.content ?? "", /Mock gateway/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("openai upstream forwards the rewritten body and strips the run JWT", async () => {
  process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-gw-openai-"));
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.LLM_UPSTREAM = "openai";
  process.env.LLM_UPSTREAM_API_KEY = "sk-upstream";
  process.env.LLM_UPSTREAM_MODEL = "gpt-4o-mini";
  process.env.LLM_GATEWAY_JWT_SECRET = "test-secret";

  let seenAuth = "";
  let seenModel = "";
  let seenMaxTokens = 0;
  const upstream = createServer((req, res) => {
    seenAuth = String(req.headers.authorization);
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string; max_tokens?: number };
      seenModel = body.model;
      seenMaxTokens = Number(body.max_tokens ?? 0);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-up",
          choices: [{ message: { role: "assistant", content: "from-upstream" }, finish_reason: "stop" }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  const upstreamAddr = upstream.address();
  if (!upstreamAddr || typeof upstreamAddr === "string") {
    throw new Error("no upstream port");
  }
  process.env.LLM_UPSTREAM_BASE_URL = `http://127.0.0.1:${upstreamAddr.port}`;

  const { proxyChatCompletions } = await import("./proxy.js");
  const result = await proxyChatCompletions({
    model: "neo/sonnet",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(result.status, 200);
  assert.equal(seenAuth, "Bearer sk-upstream");
  assert.equal(seenModel, "gpt-4o-mini");
  assert.equal(seenMaxTokens, 16_384);
  assert.match(String(result.payload), /from-upstream/);

  await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
});

test("upstream 403 becomes a JSON error instead of an empty stream", async () => {
  process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-gw-403-"));
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.LLM_UPSTREAM = "openai";
  process.env.LLM_UPSTREAM_API_KEY = "sk-upstream";
  process.env.LLM_UPSTREAM_MODEL = "gpt-4o-mini";
  process.env.LLM_GATEWAY_JWT_SECRET = "test-secret";

  const upstream = createServer((_req, res) => {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "预扣费额度失败, 用户剩余额度: ＄32" } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, resolve));
  const upstreamAddr = upstream.address();
  if (!upstreamAddr || typeof upstreamAddr === "string") {
    throw new Error("no upstream port");
  }
  process.env.LLM_UPSTREAM_BASE_URL = `http://127.0.0.1:${upstreamAddr.port}`;

  const { proxyChatCompletions } = await import("./proxy.js");
  const result = await proxyChatCompletions({
    model: "deepseek-v4-flash",
    stream: true,
    messages: [{ role: "user", content: "继续啊" }],
  });
  assert.equal(result.status, 403);
  assert.equal(result.stream, false);
  assert.match(String(result.payload), /额度预扣失败/);

  await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
});
