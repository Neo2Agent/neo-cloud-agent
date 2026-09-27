import assert from "node:assert/strict";
import test from "node:test";
import { createRunOk, jsonHeaders, login, startCoreApi } from "./helpers.js";

test("sync: GET /v1/me/events without auth is 401", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const response = await fetch(`${api.base}/v1/me/events`, { headers: { accept: "text/event-stream" } });
  assert.equal(response.status, 401);
});

test("sync: GET /v1/me/events is an SSE stream and notifies on create", async (t) => {
  const api = await startCoreApi();
  t.after(() => api.close());
  const { token } = await login(api.base);
  const stream = await fetch(`${api.base}/v1/me/events`, {
    headers: { ...jsonHeaders(token), accept: "text/event-stream" },
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.ok(stream.body);

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 8_000;

  const readUntil = async (pattern: RegExp): Promise<string> => {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (pattern.test(buffer)) return buffer;
    }
    throw new Error(`SSE timeout, got: ${buffer.slice(0, 400)}`);
  };

  await readUntil(/connected|runs\.changed|:/);
  const created = await createRunOk(api.base, token, { prompt: "list-stream ping", repoUrls: [] });
  const seen = await readUntil(new RegExp(`runs\\.changed[\\s\\S]*${created.id}|${created.id}[\\s\\S]*runs\\.changed`));
  assert.match(seen, /runs\.changed/);
  await reader.cancel();
});
