import assert from "node:assert/strict";
import test from "node:test";
import { mintRunToken } from "@neo-cloud-agent/contracts";
import {
  applyIatTranscript,
  buildIatWebSocketUrl,
  decodeIatResult,
  encodeIatFrame,
  handleIatRequest,
  resetIatSessions,
  type IatSocket,
} from "./iat.js";
import { createGatewayServer } from "./server.js";

test("buildIatWebSocketUrl is stable for a fixed date and secret", () => {
  const date = "Thu, 01 Jan 2026 00:00:00 GMT";
  const first = buildIatWebSocketUrl({ appId: "app", apiKey: "key", apiSecret: "secret" }, date);
  const second = buildIatWebSocketUrl({ appId: "app", apiKey: "key", apiSecret: "secret" }, date);
  assert.equal(first, second);
  assert.match(first, /^wss:\/\/iat-api\.xfyun\.cn\/v2\/iat\?/);
  assert.match(first, /authorization=/);
  assert.match(first, /host=iat-api\.xfyun\.cn/);
});

test("encodeIatFrame puts business params only on the first frame", () => {
  const first = encodeIatFrame("app1", 0, "AAAA");
  assert.equal(first.common?.app_id, "app1");
  assert.equal(first.business?.language, "zh_cn");
  assert.equal(first.data.status, 0);
  const mid = encodeIatFrame("app1", 1, "BBBB");
  assert.equal(mid.common, undefined);
  assert.equal(mid.data.status, 1);
});

test("decodeIatResult joins cw words", () => {
  const parsed = decodeIatResult({
    data: {
      status: 1,
      result: { ws: [{ cw: [{ w: "加" }] }, { cw: [{ w: " README" }] }] },
    },
  });
  assert.equal(parsed.text, "加 README");
  assert.equal(parsed.status, 1);
});

test("applyIatTranscript replaces the last segment on wpgs rpl", () => {
  const replaced = applyIatTranscript({ committed: "请", last: "打开" }, { text: "打开设置", status: 1, pgs: "rpl" });
  assert.equal(replaced.text, "请打开设置");
});

test("handleIatRequest refuses missing keys", async () => {
  delete process.env.IFLYTEK_APP_ID;
  delete process.env.IFLYTEK_API_KEY;
  delete process.env.IFLYTEK_API_SECRET;
  const result = await handleIatRequest({ status: 0, audio: "" });
  assert.equal(result.status, 503);
  assert.equal("error" in result.body && result.body.error, "听写未配置");
});

test("handleIatRequest opens a session and returns streamed text", async () => {
  process.env.IFLYTEK_APP_ID = "app";
  process.env.IFLYTEK_API_KEY = "key";
  process.env.IFLYTEK_API_SECRET = "secret";
  resetIatSessions();
  const listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  const sent: string[] = [];
  const connect = (): IatSocket => ({
    send: (data) => sent.push(data),
    close: () => undefined,
    addEventListener: (type, listener) => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
      if (type === "open") queueMicrotask(() => listener({}));
    },
  });
  const opened = await handleIatRequest({ status: 0, audio: "AAAA" }, connect);
  assert.equal(opened.status, 200);
  assert.equal("sessionId" in opened.body, true);
  const sessionId = "sessionId" in opened.body ? opened.body.sessionId : "";
  for (const listener of listeners.get("message") ?? []) {
    listener({
      data: JSON.stringify({
        data: { status: 1, result: { ws: [{ cw: [{ w: "你好" }] }] } },
      }),
    });
  }
  const mid = await handleIatRequest({ sessionId, status: 1, audio: "BBBB" }, connect);
  assert.equal(mid.status, 200);
  assert.equal("text" in mid.body && mid.body.text, "你好");
  const end = await handleIatRequest({ sessionId, status: 2 }, connect);
  assert.equal(end.status, 200);
  assert.equal("done" in end.body && end.body.done, true);
  assert.equal(sent.length >= 2, true);
  resetIatSessions();
});

test("gateway speech route requires a run JWT and reports iatConfigured", async () => {
  process.env.LLM_GATEWAY_JWT_SECRET = "iat-http-secret";
  delete process.env.IFLYTEK_APP_ID;
  const server = createGatewayServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const health = (await (await fetch(`${base}/health`)).json()) as { iatConfigured?: boolean };
    assert.equal(health.iatConfigured, false);
    const denied = await fetch(`${base}/v1/speech/iat`, { method: "POST", body: "{}" });
    assert.equal(denied.status, 401);
    const token = mintRunToken("iat-http-secret", {
      sub: "u",
      runId: "speech:u",
      orgId: "o",
      model: "iflytek-iat",
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: "j",
    });
    const missing = await fetch(`${base}/v1/speech/iat`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: 0 }),
    });
    assert.equal(missing.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
