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

function recorder(payload: unknown = {}) {
  const calls: Array<{ method: string; url: string; body?: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return { calls, client: new MobileClient("http://cp.test", "neo_sess_1", fetchImpl) };
}

test("memory and inbox go to the same cloud routes the web page uses", async () => {
  const { calls, client } = recorder({ configured: true, memories: [], items: [], unread: 0 });
  await client.listMemories(20);
  await client.addMemory("用 pnpm");
  await client.searchMemories("pnpm");
  await client.updateMemory("m1", "改用 bun", "2026-09-01T00:00:00.000Z");
  await client.deleteMemory("m1");
  await client.listInbox();
  await client.markInboxRead("inb_1");
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.replace("http://cp.test", "")}`),
    [
      "GET /v1/memories?limit=20",
      "POST /v1/memories",
      "POST /v1/memories/search",
      "PATCH /v1/memories/m1",
      "DELETE /v1/memories/m1",
      "GET /v1/inbox",
      "POST /v1/inbox/inb_1/read",
    ],
  );
  assert.equal(calls[2]?.body, JSON.stringify({ query: "pnpm" }));
  assert.equal(calls[3]?.body, JSON.stringify({ text: "改用 bun", updatedAt: "2026-09-01T00:00:00.000Z" }));
  assert.equal(calls[1]?.body, JSON.stringify({ text: "用 pnpm" }));
  assert.equal(calls.every((call) => call.headers.authorization === "Bearer neo_sess_1"), true);
});

test("artifacts, diagnostics and transfer use the run cloud routes", async () => {
  const { calls, client } = recorder({ artifacts: [], logs: [] });
  await client.patchRun("r1", { title: "首页改版" });
  await client.patchRun("r1", { generate: true });
  await client.listArtifacts("r1");
  await client.saveArtifactToProject("r1", "report card.html");
  await client.diagnostics("r1");
  await client.transferRun("r1", { toUserId: "u2", note: "接手" });
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.replace("http://cp.test", "")}`),
    [
      "PATCH /v1/runs/r1",
      "PATCH /v1/runs/r1",
      "GET /v1/runs/r1/artifacts",
      "POST /v1/runs/r1/artifacts/report%20card.html/save-to-project",
      "GET /v1/runs/r1/diagnostics",
      "POST /v1/runs/r1/transfer",
    ],
  );
  assert.equal(calls[0]?.body, JSON.stringify({ title: "首页改版" }));
  assert.equal(calls[1]?.body, JSON.stringify({ generate: true }));
  assert.equal(calls[5]?.body, JSON.stringify({ toUserId: "u2", note: "接手" }));
});

test("transcript pages with the shared contract default", async () => {
  const { calls, client } = recorder({ snapshot: { messages: [] } });
  await client.transcript("r1");
  await client.transcript("r1", { before: "e9" });
  assert.match(calls[0]?.url ?? "", /\/v1\/runs\/r1\/transcript\?limit=40&images=href$/);
  assert.match(calls[1]?.url ?? "", /\/v1\/runs\/r1\/transcript\?limit=40&images=href&before=e9$/);
});

test("project collaboration and plugin toggles match the web bodies", async () => {
  const { calls, client } = recorder({ assets: [], plugins: [] });
  await client.listProjectAssets("p1");
  await client.addProjectMember("p1", { email: "ping", password: "654321" });
  await client.createProjectInvite("p1");
  await client.approveProjectInvite("p1", "tok_1");
  await client.installPlugin("plug_pr_review", { scope: "user" });
  await client.enablePlugin("plug_pr_review", { enabled: false, scope: "user" });
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.replace("http://cp.test", "")}`),
    [
      "GET /v1/projects/p1/assets",
      "POST /v1/projects/p1/members",
      "POST /v1/projects/p1/invites",
      "POST /v1/projects/p1/invites/tok_1/approve",
      "POST /v1/plugins/plug_pr_review/install",
      "POST /v1/plugins/plug_pr_review/enable",
    ],
  );
  // The control plane wants an account plus an optional password, not a userId.
  assert.equal(calls[1]?.body, JSON.stringify({ email: "ping", password: "654321" }));
  assert.equal(calls[5]?.body, JSON.stringify({ enabled: false, scope: "user" }));
});

test("artifact urls resolve against the configured API base", () => {
  const client = new MobileClient("http://192.168.1.8:8080", "neo_sess_1");
  assert.equal(
    client.absoluteUrl("/v1/runs/r1/artifacts/a.html?token=t"),
    "http://192.168.1.8:8080/v1/runs/r1/artifacts/a.html?token=t",
  );
  assert.equal(client.absoluteUrl("https://neorun.cloud/x.png"), "https://neorun.cloud/x.png");
});
