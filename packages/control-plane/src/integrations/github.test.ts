import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.WORKER_RUNTIME = "none";
process.env.SPAWN_LOCAL_WORKER = "0";
process.env.LLM_GATEWAY_JWT_SECRET = "github-oauth-secret";
process.env.RUNS_DIR = mkdtempSync(path.join(tmpdir(), "neo-github-"));
delete process.env.DATABASE_URL;
delete process.env.GITHUB_OAUTH_CLIENT_ID;
delete process.env.GITHUB_OAUTH_CLIENT_SECRET;

const {
  completeGithubOAuthCallback,
  createGithubAuthorizeUrl,
  disconnectGithubAccount,
  githubOAuthConfigured,
  listGithubRepos,
  publicGithubAccount,
  setGithubOAuthApiForTest,
  settingsPageUrl,
  signGithubOAuthState,
  verifyGithubOAuthState,
} = await import("./github.js");
const { deleteGithubConnection, getGithubConnection, putGithubConnection } = await import("./github-store.js");
const { resolveScmPushToken } = await import("../scm/token.js");

test("oauth is off until both client id and secret are set", () => {
  assert.equal(githubOAuthConfigured(), false);
  process.env.GITHUB_OAUTH_CLIENT_ID = "client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
  try {
    assert.equal(githubOAuthConfigured(), true);
    const url = new URL(createGithubAuthorizeUrl("user-1", "https://neorun.cloud"));
    assert.equal(url.origin, "https://github.com");
    assert.equal(url.searchParams.get("client_id"), "client");
    assert.equal(url.searchParams.get("redirect_uri"), "https://neorun.cloud/v1/integrations/github/callback");
    assert.match(url.searchParams.get("scope") ?? "", /repo/);
    assert.ok(url.searchParams.get("state"));
  } finally {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  }
});

test("oauth state is bound to a user and expires", () => {
  const now = Date.now();
  const state = signGithubOAuthState("user-9", now);
  assert.equal(verifyGithubOAuthState(state, now), "user-9");
  assert.throws(() => verifyGithubOAuthState(state, now + 11 * 60 * 1000), /invalid_state/);
  assert.throws(() => verifyGithubOAuthState("not-a-state"), /invalid_state/);
});

test("callback stores the user token and listRepos filters by q", async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
  setGithubOAuthApiForTest({
    async exchangeCode() {
      return { accessToken: "gho_user_token", scope: "read:user,repo" };
    },
    async fetchUser() {
      return { login: "ada" };
    },
    async listRepos() {
      return [
        { fullName: "ada/notes", url: "https://github.com/ada/notes.git" },
        { fullName: "acme/app", url: "https://github.com/acme/app.git" },
      ];
    },
  });
  try {
    const userId = "user-ada";
    await completeGithubOAuthCallback({
      code: "abc",
      state: signGithubOAuthState(userId),
      userId,
      origin: "https://neorun.cloud",
    });
    const stored = await getGithubConnection(userId);
    assert.equal(stored?.login, "ada");
    assert.equal(stored?.accessToken, "gho_user_token");
    const listed = await listGithubRepos(userId, "acme");
    assert.equal(listed.connected, true);
    assert.equal(listed.login, "ada");
    assert.deepEqual(
      listed.repos.map((item) => item.fullName),
      ["acme/app"],
    );
    assert.equal(await resolveScmPushToken(userId), "gho_user_token");
    await disconnectGithubAccount(userId);
    assert.equal(await getGithubConnection(userId), null);
    const empty = await listGithubRepos(userId);
    assert.equal(empty.connected, false);
    assert.deepEqual(empty.repos, []);
  } finally {
    setGithubOAuthApiForTest(null);
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  }
});

test("public account never echoes the token", async () => {
  await putGithubConnection({
    userId: "user-pub",
    login: "neo",
    accessToken: "gho_secret",
    scopes: "repo",
    updatedAt: new Date().toISOString(),
  });
  const pub = await publicGithubAccount("user-pub");
  assert.equal(pub.connected, true);
  assert.equal(pub.login, "neo");
  assert.doesNotMatch(JSON.stringify(pub), /gho_secret/);
  assert.equal(settingsPageUrl("https://neorun.cloud", "denied"), "https://neorun.cloud/#/settings?github=denied");
  await deleteGithubConnection("user-pub");
});
