import assert from "node:assert/strict";
import test from "node:test";
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
    const config = getConfig();
    assert.equal(config.upstream, "deepseek");
    assert.equal(config.upstreamBaseUrl, "https://api.deepseek.com/v1");
    assert.equal(config.upstreamModel, "deepseek-chat");
    assert.equal(config.upstreamApiKey, "sk-test-deepseek");
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
