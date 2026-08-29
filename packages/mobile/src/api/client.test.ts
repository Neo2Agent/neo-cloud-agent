import assert from "node:assert/strict";
import test from "node:test";
import { describeNetworkError, MobileApiError, MobileClient } from "./client.js";
import { memoryCredentials } from "./credentials.js";

test("describeNetworkError maps fetch failures to a reachable host hint", () => {
  assert.match(
    describeNetworkError(new Error("Network request failed"), "https://neorun.cloud/v1/auth/login"),
    /neorun\.cloud/,
  );
});

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

test("MobileClient posts automations and projects without a Desk marker", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ id: "a1", automations: [], projects: [], teams: [] }), { status: 200 });
  }) as typeof fetch;
  const client = new MobileClient("http://cp.test", "neo_sess_1", fetchImpl);
  await client.listAutomations();
  await client.createProject({ name: "P", invitePolicy: "approve" });
  assert.equal(calls.every((url) => !url.includes("client=desk")), true);
  assert.match(calls[0] ?? "", /\/v1\/automations/);
  assert.match(calls[1] ?? "", /\/v1\/projects/);
});

test("MobileClient never marks itself as a Desk client", async () => {
  const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers });
    return new Response(JSON.stringify({ runs: [], id: "r1", token: "t", user: { email: "a" } }), { status: 200 });
  }) as typeof fetch;
  const client = new MobileClient("http://cp.test", "neo_sess_1", fetchImpl);
  await client.listRuns();
  await client.createRun({ prompt: "hi", repoUrls: [], source: "ios", target: { loop: "cloud", tools: "cloud" } });
  assert.equal(calls.every((call) => !call.url.includes("client=desk")), true);
  assert.equal(
    calls.every((call) => {
      const headers = (call.headers ?? {}) as Record<string, string>;
      return headers["x-neo-client"] !== "desk" && headers["X-Neo-Client"] !== "desk";
    }),
    true,
  );
});

test("MobileClient surfaces API errors", async () => {
  const client = new MobileClient("", "", (async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as typeof fetch);
  await assert.rejects(() => client.me(), (error: unknown) => error instanceof MobileApiError && error.status === 401);
});
