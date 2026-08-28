import assert from "node:assert/strict";
import test from "node:test";
import { MobileApiError, MobileClient } from "./client.js";
import { memoryCredentials } from "./credentials.js";

test("memory credentials store a session token", async () => {
  const store = memoryCredentials();
  await store.setToken("neo_sess_x");
  assert.equal(await store.getToken(), "neo_sess_x");
  await store.clearToken();
  assert.equal(await store.getToken(), "");
});

test("MobileClient sends Bearer and never puts the token in the SSE query", async () => {
  const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers });
    if (String(input).includes("/events")) {
      return new Response("id: e1\ndata: {\"id\":\"e1\",\"kind\":\"run.idle\",\"runId\":\"r1\",\"createdAt\":\"t\",\"category\":\"agent_run\",\"level\":\"info\",\"title\":\"Idle\"}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response(JSON.stringify({ ok: true, token: "neo_sess_1", user: { email: "admin" } }), { status: 200 });
  }) as typeof fetch;
  const client = new MobileClient("http://cp.test", "neo_sess_1", fetchImpl);
  const login = await client.login("admin", "123456");
  assert.equal(login.token, "neo_sess_1");
  assert.match(String((calls[0]?.headers as Record<string, string>).authorization), /Bearer neo_sess_1/);
  const events: string[] = [];
  await client.streamEvents("r1", (event) => events.push(event.kind), { after: "e0" });
  assert.equal(events[0], "run.idle");
  assert.match(calls[1]?.url ?? "", /\/v1\/runs\/r1\/events\?after=e0/);
  assert.equal((calls[1]?.url ?? "").includes("access_token"), false);
  assert.equal((calls[1]?.headers as Record<string, string>)["Last-Event-ID"], "e0");
});

test("MobileClient surfaces API errors", async () => {
  const client = new MobileClient("", "", (async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as typeof fetch);
  await assert.rejects(() => client.me(), (error: unknown) => error instanceof MobileApiError && error.status === 401);
});
