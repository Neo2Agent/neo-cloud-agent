import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { mintRunToken } from "@neo-cloud-agent/contracts";
import { buildMockSse, rewriteBody } from "./proxy.js";
import { resolveUpstreamModel } from "./routes.js";
import { createGatewayServer } from "./server.js";

test("rewrites public model ids to the upstream fallback", () => {
  const rewritten = rewriteBody({ model: "neo/sonnet", messages: [] }, "gpt-4o-mini");
  assert.equal(rewritten.model, "gpt-4o-mini");
  assert.equal(resolveUpstreamModel("unknown-model", "gpt-4o-mini"), "gpt-4o-mini");
});

test("maps DeepSeek public ids and retired aliases to v4-flash", () => {
  assert.equal(resolveUpstreamModel("neo/deepseek", "deepseek-v4-flash"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("neo/ds", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("ds", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("deepseek", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("deepseek-chat", "gpt-4o-mini"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("deepseek-reasoner", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveUpstreamModel("deepseek-v4-pro", "deepseek-v4-flash"), "deepseek-v4-pro");
});

test("mock SSE is OpenAI-compatible", () => {
  const sse = buildMockSse("gpt-4o-mini", "hello");
  assert.match(sse, /data: \{"id":"chatcmpl-/);
  assert.match(sse, /"content":"hello"/);
  assert.match(sse, /data: \[DONE\]/);
});

test("gateway requires a run JWT and can forward to an OpenAI-compatible upstream", async () => {
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
  process.env.LLM_UPSTREAM = "openai";
  process.env.LLM_UPSTREAM_API_KEY = "sk-upstream";
  process.env.LLM_UPSTREAM_MODEL = "gpt-4o-mini";
  process.env.LLM_GATEWAY_JWT_SECRET = "test-secret";

  let seenAuth = "";
  let seenModel = "";
  const upstream = createServer((req, res) => {
    seenAuth = String(req.headers.authorization);
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string };
      seenModel = body.model;
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
  assert.match(String(result.payload), /from-upstream/);

  await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
});
