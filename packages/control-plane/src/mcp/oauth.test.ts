import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.LLM_SETTINGS_DIR = mkdtempSync(path.join(tmpdir(), "neo-mcp-oauth-"));
process.env.LLM_GATEWAY_JWT_SECRET = "oauth-test-secret";

const { upsertMcpSecret } = await import("./secrets.js");
const { beginMcpOAuth, finishMcpOAuth, signMcpOAuthState, verifyMcpOAuthState } = await import("./oauth.js");

test("MCP OAuth state signs and verifies", () => {
  const state = signMcpOAuthState("docs");
  assert.equal(verifyMcpOAuthState(state), "docs");
  assert.throws(() => verifyMcpOAuthState("nope"), /invalid OAuth state/);
});

test("beginMcpOAuth builds an authorize URL and finish stores the token", async () => {
  upsertMcpSecret("docs", {
    oauth: {
      authorizeUrl: "https://auth.example/authorize",
      tokenUrl: "https://auth.example/token",
      clientId: "client-1",
      clientSecret: "secret-1",
      scopes: "read",
    },
  });
  const started = beginMcpOAuth("docs", "https://app.example");
  assert.match(started.url, /auth\.example\/authorize/);
  assert.match(started.url, /client_id=client-1/);
  assert.equal(started.redirectUri, "https://app.example/oauth/callback/mcp");
  const state = new URL(started.url).searchParams.get("state") ?? "";
  const name = await finishMcpOAuth(
    { code: "code-1", state, origin: "https://app.example" },
    async (input, init) => {
      assert.equal(String(input), "https://auth.example/token");
      assert.match(String(init?.body ?? ""), /grant_type=authorization_code/);
      return new Response(JSON.stringify({ access_token: "tok-1", refresh_token: "ref-1", expires_in: 3600 }));
    },
  );
  assert.equal(name, "docs");
});
