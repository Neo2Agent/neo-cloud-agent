import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  githubAppConfig,
  mintGithubAppJwt,
  mintGithubInstallationToken,
  normalizePem,
  resetGithubAppTokenCache,
  setGithubAppApiForTests,
} from "./github-app.js";
import { resolveScmPushToken } from "./token.js";

function testAppKey() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
  };
}

test("normalizePem accepts escaped newlines and base64", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----";
  assert.equal(normalizePem(pem.replaceAll("\n", "\\n")), pem);
  assert.equal(normalizePem(Buffer.from(pem).toString("base64")), pem);
  assert.equal(normalizePem("not-a-key"), "");
});

test("mints a verifiable GitHub App JWT", () => {
  const { privatePem, publicPem } = testAppKey();
  const nowMs = Date.parse("2026-08-21T00:00:00.000Z");
  const jwt = mintGithubAppJwt("4242", privatePem, nowMs);
  const [header, payload, signature] = jwt.split(".");
  assert.ok(header && payload && signature);
  const verify = createVerify("SHA256");
  verify.update(`${header}.${payload}`);
  verify.end();
  assert.equal(verify.verify(publicPem, signature, "base64url"), true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iss: string; iat: number; exp: number };
  assert.equal(claims.iss, "4242");
  assert.equal(claims.iat, Math.floor(nowMs / 1000) - 60);
  assert.equal(claims.exp, Math.floor(nowMs / 1000) + 9 * 60);
});

test.describe("installation token minting", { concurrency: 1 }, () => {
test("resolveScmPushToken prefers a GitHub App installation token", async () => {
  const { privatePem } = testAppKey();
  const previous = {
    id: process.env.GITHUB_APP_ID,
    key: process.env.GITHUB_APP_PRIVATE_KEY,
    installation: process.env.GITHUB_APP_INSTALLATION_ID,
    token: process.env.GITHUB_TOKEN,
    scm: process.env.SCM_PUSH_TOKEN,
    gh: process.env.GH_TOKEN,
  };
  process.env.GITHUB_APP_ID = "99";
  process.env.GITHUB_APP_PRIVATE_KEY = privatePem;
  process.env.GITHUB_APP_INSTALLATION_ID = "123456";
  process.env.GITHUB_TOKEN = "ghp-must-not-win";
  delete process.env.SCM_PUSH_TOKEN;
  delete process.env.GH_TOKEN;
  let seenJwt = "";
  setGithubAppApiForTests({
    async createInstallationToken(jwt, installationId) {
      seenJwt = jwt;
      assert.equal(installationId, "123456");
      return { token: "ghs_install_token", expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    },
  });
  try {
    assert.ok(githubAppConfig());
    assert.equal(await resolveScmPushToken(), "ghs_install_token");
    assert.ok(seenJwt.split(".").length === 3);
    assert.equal(await resolveScmPushToken(), "ghs_install_token");
  } finally {
    setGithubAppApiForTests(null);
    resetGithubAppTokenCache();
    restoreEnv("GITHUB_APP_ID", previous.id);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previous.key);
    restoreEnv("GITHUB_APP_INSTALLATION_ID", previous.installation);
    restoreEnv("GITHUB_TOKEN", previous.token);
    restoreEnv("SCM_PUSH_TOKEN", previous.scm);
    restoreEnv("GH_TOKEN", previous.gh);
  }
});

test("resolveScmPushToken falls back to a PAT when the App API fails", async () => {
  const { privatePem } = testAppKey();
  const previous = {
    id: process.env.GITHUB_APP_ID,
    key: process.env.GITHUB_APP_PRIVATE_KEY,
    installation: process.env.GITHUB_APP_INSTALLATION_ID,
    token: process.env.GITHUB_TOKEN,
  };
  process.env.GITHUB_APP_ID = "99";
  process.env.GITHUB_APP_PRIVATE_KEY = privatePem;
  process.env.GITHUB_APP_INSTALLATION_ID = "123456";
  process.env.GITHUB_TOKEN = "ghp-fallback";
  setGithubAppApiForTests({
    async createInstallationToken() {
      throw new Error("github down");
    },
  });
  try {
    assert.equal(await resolveScmPushToken(), "ghp-fallback");
  } finally {
    setGithubAppApiForTests(null);
    resetGithubAppTokenCache();
    restoreEnv("GITHUB_APP_ID", previous.id);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previous.key);
    restoreEnv("GITHUB_APP_INSTALLATION_ID", previous.installation);
    restoreEnv("GITHUB_TOKEN", previous.token);
  }
});

test("mintGithubInstallationToken caches until shortly before expiry", async () => {
  let calls = 0;
  setGithubAppApiForTests({
    async createInstallationToken() {
      calls += 1;
      return { token: `ghs_${calls}`, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    },
  });
  try {
    const first = await mintGithubInstallationToken({
      appId: "1",
      privateKey: testAppKey().privatePem,
      installationId: "2",
    });
    const second = await mintGithubInstallationToken({
      appId: "1",
      privateKey: testAppKey().privatePem,
      installationId: "2",
    });
    assert.equal(first.token, "ghs_1");
    assert.equal(second.token, "ghs_1");
    assert.equal(calls, 1);
  } finally {
    setGithubAppApiForTests(null);
    resetGithubAppTokenCache();
  }
});
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
