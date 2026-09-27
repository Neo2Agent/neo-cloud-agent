import assert from "node:assert/strict";
import test from "node:test";
import { MobileClient } from "./api/client.js";
import { cloudSettingsFromMobile, githubAuthorizeHref } from "./cloud-settings-client.js";

test("githubAuthorizeHref stays on the same control-plane host", () => {
  assert.equal(
    githubAuthorizeHref("https://neorun.cloud/"),
    "https://neorun.cloud/v1/integrations/github/authorize",
  );
});

test("cloudSettingsFromMobile talks to the same /v1 paths as Web", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? "GET",
      path: String(input).replace("http://cp.test", ""),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const client = cloudSettingsFromMobile(new MobileClient("http://cp.test", "neo_sess_1", fetchImpl));
  await client.getJson("/v1/quota");
  await client.sendJson("/v1/settings/mcp", { method: "POST", body: { name: "env", bearer: "tok" } });
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    ["GET /v1/quota", "POST /v1/settings/mcp"],
  );
  assert.deepEqual(calls[1]?.body, { name: "env", bearer: "tok" });
});
