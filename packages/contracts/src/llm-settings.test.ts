import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseLlmSettingsRequest,
  publicLlmSettings,
  readLlmSettings,
  writeLlmSettings,
} from "./llm-settings.js";

test("writeLlmSettings persists the key and public view never returns it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-llm-settings-"));
  const published = writeLlmSettings({ upstream: "deepseek", apiKey: "sk-secret-key" }, root);
  assert.equal(published.configured, true);
  assert.equal(published.upstream, "deepseek");
  assert.equal(published.model, "deepseek-chat");
  assert.doesNotMatch(JSON.stringify(published), /sk-secret-key/);
  const stored = readFileSync(path.join(root, ".neo", "llm-upstream.env"), "utf8");
  assert.match(stored, /DEEPSEEK_API_KEY=sk-secret-key/);
  const read = readLlmSettings(root);
  assert.equal(read?.apiKey, "sk-secret-key");
  assert.equal(publicLlmSettings(read).configured, true);
});

test("writeLlmSettings keeps the existing key when the request omits it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-llm-keep-"));
  writeLlmSettings({ upstream: "deepseek", apiKey: "sk-keep-me" }, root);
  const published = writeLlmSettings({ upstream: "openai", model: "gpt-4o-mini" }, root);
  assert.equal(published.upstream, "openai");
  assert.equal(readLlmSettings(root)?.apiKey, "sk-keep-me");
  assert.match(readFileSync(path.join(root, ".neo", "llm-upstream.env"), "utf8"), /OPENAI_API_KEY=sk-keep-me/);
});

test("parseLlmSettingsRequest rejects a missing upstream and multiline keys", () => {
  assert.throws(() => parseLlmSettingsRequest({}), /upstream/);
  assert.throws(() => parseLlmSettingsRequest({ upstream: "deepseek", apiKey: "sk-1\nsk-2" }), /single line/);
  assert.deepEqual(parseLlmSettingsRequest({ upstream: "deepseek", apiKey: "  sk-ok  " }), {
    upstream: "deepseek",
    apiKey: "sk-ok",
  });
});
