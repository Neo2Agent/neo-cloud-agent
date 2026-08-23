import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeLlmSettings } from "@neo-cloud-agent/contracts";
import { getConfig } from "./config.js";

test("deepseek preset uses official base URL and chat model", () => {
  const previous = {
    LLM_UPSTREAM: process.env.LLM_UPSTREAM,
    LLM_UPSTREAM_BASE_URL: process.env.LLM_UPSTREAM_BASE_URL,
    LLM_UPSTREAM_MODEL: process.env.LLM_UPSTREAM_MODEL,
    LLM_UPSTREAM_API_KEY: process.env.LLM_UPSTREAM_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.LLM_UPSTREAM = "deepseek";
  delete process.env.LLM_UPSTREAM_BASE_URL;
  delete process.env.LLM_UPSTREAM_MODEL;
  delete process.env.LLM_UPSTREAM_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-test-deepseek";

  try {
    const config = getConfig(mkdtempSync(path.join(tmpdir(), "neo-llm-preset-")));
    assert.equal(config.upstream, "deepseek");
    assert.equal(config.upstreamBaseUrl, "https://api.deepseek.com/v1");
    assert.equal(config.upstreamModel, "deepseek-v4-flash");
    assert.equal(config.upstreamApiKey, "sk-test-deepseek");
    assert.equal(config.configured, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("saved settings file wins over LLM_UPSTREAM=mock", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-llm-override-"));
  writeLlmSettings({ upstream: "deepseek", apiKey: "sk-from-file" }, root);
  const previous = {
    LLM_UPSTREAM: process.env.LLM_UPSTREAM,
    LLM_UPSTREAM_BASE_URL: process.env.LLM_UPSTREAM_BASE_URL,
    LLM_UPSTREAM_MODEL: process.env.LLM_UPSTREAM_MODEL,
    LLM_UPSTREAM_API_KEY: process.env.LLM_UPSTREAM_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.LLM_UPSTREAM = "mock";
  process.env.LLM_UPSTREAM_MODEL = "gpt-4o-mini";
  process.env.LLM_UPSTREAM_BASE_URL = "https://api.openai.com/v1";
  delete process.env.LLM_UPSTREAM_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const config = getConfig(root);
    assert.equal(config.upstream, "deepseek");
    assert.equal(config.upstreamApiKey, "sk-from-file");
    assert.equal(config.upstreamModel, "deepseek-v4-flash");
    assert.equal(config.upstreamBaseUrl, "https://api.deepseek.com/v1");
    assert.equal(config.configured, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("saved OpenAI settings can override the upstream base URL", () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-llm-baseurl-"));
  writeLlmSettings(
    {
      upstream: "openai",
      apiKey: "sk-from-file",
      model: "gpt-4o-mini",
      baseUrl: "https://proxy.example/v1",
    },
    root,
  );
  const previous = {
    LLM_UPSTREAM: process.env.LLM_UPSTREAM,
    LLM_UPSTREAM_BASE_URL: process.env.LLM_UPSTREAM_BASE_URL,
    LLM_UPSTREAM_MODEL: process.env.LLM_UPSTREAM_MODEL,
    LLM_UPSTREAM_API_KEY: process.env.LLM_UPSTREAM_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.LLM_UPSTREAM = "mock";
  delete process.env.LLM_UPSTREAM_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const config = getConfig(root);
    assert.equal(config.upstream, "openai");
    assert.equal(config.upstreamApiKey, "sk-from-file");
    assert.equal(config.upstreamModel, "gpt-4o-mini");
    assert.equal(config.upstreamBaseUrl, "https://proxy.example/v1");
    assert.equal(config.configured, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
