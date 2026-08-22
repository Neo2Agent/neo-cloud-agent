import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "neo-scm-settings-"));
process.env.LLM_SETTINGS_DIR = dir;
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;
delete process.env.GITHUB_APP_INSTALLATION_ID;
delete process.env.SCM_PUSH_TOKEN;
delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;

const { publicScmSettings, readStoredScmToken, writeScmSettings } = await import("./settings.js");
const { scmPushToken } = await import("./token.js");

test("stored PAT is used when env has no GitHub App or token", () => {
  assert.equal(publicScmSettings().method, "none");
  const saved = writeScmSettings({ token: "ghp_stored_pat_token" });
  assert.equal(saved.configured, true);
  assert.equal(saved.method, "pat");
  assert.equal(readStoredScmToken(), "ghp_stored_pat_token");
  assert.equal(scmPushToken(), "ghp_stored_pat_token");
  writeScmSettings({ clear: true });
  assert.equal(publicScmSettings().method, "none");
  assert.equal(scmPushToken(), null);
});
