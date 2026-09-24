import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "github-account-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-github-api-"));
process.env.ACCOUNTS_REQUIRED = "1";
process.env.PUBLIC_APP_URL = "https://neorun.cloud";
delete process.env.WORKER_WORKSPACE_MOUNT;
delete process.env.CONTROL_PLANE_TOKEN;
delete process.env.CONTROL_PLANE_AUTH;
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.BOOTSTRAP_EMAIL;
delete process.env.BOOTSTRAP_PASSWORD;
delete process.env.GITHUB_OAUTH_CLIENT_ID;
delete process.env.GITHUB_OAUTH_CLIENT_SECRET;

const { createApiServer } = await import("./server.js");
const { ensureDefaultAdmin } = await import("../accounts/accounts.js");
const { listen, close } = await import("../e2e/helpers.js");
const { setGithubOAuthApiForTest, signGithubOAuthState } = await import("../integrations/github.js");

async function loginAdmin(base: string): Promise<{ token: string; userId: string }> {
  await ensureDefaultAdmin();
  const login = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin", password: "123456" }),
  });
  assert.equal(login.status, 200);
  const body = (await login.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

test("github account API: authorize requires login; repos empty until bound; callback + delete", async (t) => {
  const server = createApiServer();
  const port = await listen(server);
  t.after(async () => {
    await close(server);
    setGithubOAuthApiForTest(null);
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.ACCOUNTS_REQUIRED;
  });
  const base = `http://127.0.0.1:${port}`;

  const unauth = await fetch(`${base}/v1/integrations/github/authorize`, { redirect: "manual" });
  assert.equal(unauth.status, 401);

  const { token, userId } = await loginAdmin(base);
  const auth = { authorization: `Bearer ${token}` };

  const missingOauth = await fetch(`${base}/v1/integrations/github/authorize`, { headers: auth, redirect: "manual" });
  assert.equal(missingOauth.status, 503);

  const emptyRepos = (await (await fetch(`${base}/v1/scm/repos`, { headers: auth })).json()) as {
    configured: boolean;
    repos: unknown[];
  };
  assert.equal(emptyRepos.configured, false);
  assert.deepEqual(emptyRepos.repos, []);

  process.env.GITHUB_OAUTH_CLIENT_ID = "client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
  setGithubOAuthApiForTest({
    async exchangeCode() {
      return { accessToken: "gho_api_token", scope: "repo" };
    },
    async fetchUser() {
      return { login: "octocat" };
    },
    async listRepos() {
      return [
        { fullName: "octocat/hello", url: "https://github.com/octocat/hello.git" },
        { fullName: "acme/app", url: "https://github.com/acme/app.git" },
      ];
    },
  });

  const authorize = await fetch(`${base}/v1/integrations/github/authorize`, { headers: auth, redirect: "manual" });
  assert.equal(authorize.status, 302);
  const location = authorize.headers.get("location") ?? "";
  assert.match(location, /^https:\/\/github.com\/login\/oauth\/authorize/);
  const state = new URL(location).searchParams.get("state") ?? "";
  assert.ok(state);

  const callback = await fetch(
    `${base}/v1/integrations/github/callback?code=abc&state=${encodeURIComponent(signGithubOAuthState(userId))}`,
    { headers: auth, redirect: "manual" },
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "https://neorun.cloud/#/settings?github=ok");

  const status = (await (await fetch(`${base}/v1/integrations/github`, { headers: auth })).json()) as {
    connected: boolean;
    login: string | null;
  };
  assert.equal(status.connected, true);
  assert.equal(status.login, "octocat");
  assert.doesNotMatch(JSON.stringify(status), /gho_api_token/);

  const repos = (await (await fetch(`${base}/v1/scm/repos?q=acme`, { headers: auth })).json()) as {
    configured: boolean;
    login: string;
    repos: Array<{ fullName: string }>;
  };
  assert.equal(repos.configured, true);
  assert.equal(repos.login, "octocat");
  assert.deepEqual(
    repos.repos.map((item) => item.fullName),
    ["acme/app"],
  );

  const cleared = await fetch(`${base}/v1/integrations/github`, { method: "DELETE", headers: auth });
  assert.equal(cleared.status, 200);
  const after = (await cleared.json()) as { connected: boolean };
  assert.equal(after.connected, false);
  const reposAfter = (await (await fetch(`${base}/v1/scm/repos`, { headers: auth })).json()) as { configured: boolean };
  assert.equal(reposAfter.configured, false);

  const noCookie = await fetch(
    `${base}/v1/integrations/github/callback?code=abc&state=${encodeURIComponent(signGithubOAuthState(userId))}`,
    { redirect: "manual" },
  );
  assert.equal(noCookie.status, 302);
  assert.equal(noCookie.headers.get("location"), "https://neorun.cloud/#/settings?github=ok");
  const persisted = (await (await fetch(`${base}/v1/integrations/github`, { headers: auth })).json()) as {
    connected: boolean;
    login: string | null;
  };
  assert.equal(persisted.connected, true);
  assert.equal(persisted.login, "octocat");

  await fetch(`${base}/v1/integrations/github`, { method: "DELETE", headers: auth });

  const expired = await fetch(
    `${base}/v1/integrations/github/callback?code=abc&state=${encodeURIComponent(signGithubOAuthState(userId, Date.now() - 11 * 60 * 1000))}`,
    { redirect: "manual" },
  );
  assert.equal(expired.status, 302);
  assert.equal(expired.headers.get("location"), "https://neorun.cloud/#/settings?github=invalid_state");

  const forged = await fetch(`${base}/v1/integrations/github/callback?code=abc&state=not-a-state`, {
    redirect: "manual",
  });
  assert.equal(forged.status, 302);
  assert.equal(forged.headers.get("location"), "https://neorun.cloud/#/settings?github=invalid_state");

  const mismatch = await fetch(
    `${base}/v1/integrations/github/callback?code=abc&state=${encodeURIComponent(signGithubOAuthState("other-user"))}`,
    { headers: auth, redirect: "manual" },
  );
  assert.equal(mismatch.status, 302);
  assert.equal(mismatch.headers.get("location"), "https://neorun.cloud/#/settings?github=state_user_mismatch");

  const untouched = (await (await fetch(`${base}/v1/integrations/github`, { headers: auth })).json()) as {
    connected: boolean;
  };
  assert.equal(untouched.connected, false);
});
