import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { verifyRunToken } from "@neo-cloud-agent/contracts";
import { listen, close } from "../e2e/helpers.js";
import { mintSpeechGatewayToken, proxySpeechIat } from "./iat-proxy.js";

test("mintSpeechGatewayToken is a short-lived speech JWT", () => {
  process.env.LLM_GATEWAY_JWT_SECRET = "speech-secret";
  const token = mintSpeechGatewayToken({ kind: "user", userId: "u1", orgId: "o1", email: "a@b.c", sessionId: "s" });
  const claims = verifyRunToken("speech-secret", token);
  assert.equal(claims.runId, "speech:u1");
  assert.equal(claims.model, "iflytek-iat");
});

test("proxySpeechIat forwards audio to the gateway", async (t) => {
  process.env.LLM_GATEWAY_JWT_SECRET = "speech-secret";
  const seen: Array<{ auth?: string; body: unknown }> = [];
  const gateway = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      seen.push({
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sessionId: "s1", text: "你好" }));
    });
  });
  const port = await listen(gateway);
  t.after(async () => {
    await close(gateway);
  });
  process.env.LLM_GATEWAY_URL = `http://127.0.0.1:${port}`;
  const result = await proxySpeechIat(
    { kind: "user", userId: "u1", orgId: "o1", email: "a@b.c", sessionId: "s" },
    { status: 0, audio: "AAAA" },
  );
  assert.equal(result.status, 200);
  assert.equal((result.payload as { text?: string }).text, "你好");
  assert.match(seen[0]?.auth ?? "", /Bearer /);
  assert.equal((seen[0]?.body as { status?: number }).status, 0);
});
