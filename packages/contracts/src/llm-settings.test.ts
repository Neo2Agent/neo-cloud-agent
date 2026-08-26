import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalizeLlmModel,
  llmSettingsFile,
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
  assert.equal(published.model, "deepseek-v4-flash");
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

test("readLlmSettings walks up from a package cwd to the workspace root", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "neo-llm-root-"));
  writeFileSync(path.join(workspace, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(path.join(workspace, "packages", "control-plane"), { recursive: true });
  writeLlmSettings({ upstream: "deepseek", apiKey: "sk-workspace-root" }, workspace);
  const previous = process.cwd();
  const previousDir = process.env.LLM_SETTINGS_DIR;
  delete process.env.LLM_SETTINGS_DIR;
  try {
    process.chdir(path.join(workspace, "packages", "control-plane"));
    const read = readLlmSettings();
    assert.equal(read?.apiKey, "sk-workspace-root");
    assert.equal(path.basename(path.dirname(path.dirname(llmSettingsFile()))), path.basename(workspace));
  } finally {
    process.chdir(previous);
    if (previousDir === undefined) {
      delete process.env.LLM_SETTINGS_DIR;
    } else {
      process.env.LLM_SETTINGS_DIR = previousDir;
    }
  }
});

test("canonicalizeLlmModel remaps retired DeepSeek aliases to v4-flash", () => {
  assert.equal(canonicalizeLlmModel("deepseek"), "deepseek-v4-flash");
  assert.equal(canonicalizeLlmModel("deepseek", "deepseek-chat"), "deepseek-v4-flash");
  assert.equal(canonicalizeLlmModel("deepseek", "deepseek-reasoner"), "deepseek-v4-flash");
  assert.equal(canonicalizeLlmModel("deepseek", "deepseek-v4-pro"), "deepseek-v4-pro");
  assert.equal(canonicalizeLlmModel("deepseek", "deepseek-vision"), "deepseek-v4-flash-vision-exp");
  assert.equal(canonicalizeLlmModel("deepseek", "deepseek-v4-flash-vision-exp"), "deepseek-v4-flash-vision-exp");
});

test("readLlmSettings remaps a saved deepseek-chat id", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-llm-alias-"));
  mkdirSync(path.join(root, ".neo"), { recursive: true });
  writeFileSync(
    path.join(root, ".neo", "llm-upstream.env"),
    "LLM_UPSTREAM=deepseek\nLLM_UPSTREAM_MODEL=deepseek-chat\nDEEPSEEK_API_KEY=sk-old\n",
  );
  const read = readLlmSettings(root);
  assert.equal(read?.model, "deepseek-v4-flash");
  assert.equal(publicLlmSettings(read).model, "deepseek-v4-flash");
});

test("parseLlmSettingsRequest rejects a missing upstream and multiline keys", () => {
  assert.throws(() => parseLlmSettingsRequest({}), /upstream/);
  assert.throws(() => parseLlmSettingsRequest({ upstream: "deepseek", apiKey: "sk-1\nsk-2" }), /single line/);
  assert.throws(() => parseLlmSettingsRequest({ upstream: "openai", baseUrl: "not-a-url" }), /http\(s\)/);
  assert.deepEqual(parseLlmSettingsRequest({ upstream: "deepseek", apiKey: "  sk-ok  " }), {
    upstream: "deepseek",
    apiKey: "sk-ok",
  });
});

test("publicLlmSettings includes New API console info from the environment", () => {
  const previousUrl = process.env.NEW_API_URL;
  const previousConsole = process.env.NEW_API_CONSOLE_URL;
  process.env.NEW_API_URL = "http://127.0.0.1:3000";
  process.env.NEW_API_CONSOLE_URL = "http://127.0.0.1:3000";
  try {
    const published = publicLlmSettings(null);
    assert.equal(published.newApi?.url, "http://127.0.0.1:3000");
    assert.equal(published.newApi?.consoleUrl, "http://127.0.0.1:3000");
  } finally {
    if (previousUrl === undefined) delete process.env.NEW_API_URL;
    else process.env.NEW_API_URL = previousUrl;
    if (previousConsole === undefined) delete process.env.NEW_API_CONSOLE_URL;
    else process.env.NEW_API_CONSOLE_URL = previousConsole;
  }
});

test("writeLlmSettings persists an OpenAI-compatible base URL", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-llm-baseurl-"));
  const published = writeLlmSettings(
    {
      upstream: "openai",
      apiKey: "sk-openai",
      model: "my-qwen",
      baseUrl: "https://proxy.example/v1/",
    },
    root,
  );
  assert.equal(published.configured, true);
  assert.equal(published.upstream, "openai");
  assert.equal(published.model, "my-qwen");
  assert.equal(published.baseUrl, "https://proxy.example/v1");
  const stored = readFileSync(path.join(root, ".neo", "llm-upstream.env"), "utf8");
  assert.match(stored, /LLM_UPSTREAM_BASE_URL=https:\/\/proxy.example\/v1/);
  assert.equal(readLlmSettings(root)?.baseUrl, "https://proxy.example/v1");
});
