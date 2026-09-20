import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { writeLlmSettings } from "@neo-cloud-agent/contracts";
import { publishedLlmSettings, resetLlmCatalogCache, resolveLlmCatalog } from "./catalog.js";

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("no listen port");
  }
  return address.port;
}

test("mock or unconfigured upstream keeps the static Flash + Step catalog", async () => {
  resetLlmCatalogCache();
  const root = mkdtempSync(path.join(tmpdir(), "neo-catalog-static-"));
  const previous = process.env.LLM_SETTINGS_DIR;
  process.env.LLM_SETTINGS_DIR = root;
  delete process.env.NEW_API_URL;
  try {
    const catalog = await resolveLlmCatalog(null);
    assert.equal(catalog.modelsSource, "static");
    assert.deepEqual(
      catalog.models.map((item) => item.id),
      ["deepseek-flash", "step-5-preview"],
    );
  } finally {
    if (previous === undefined) delete process.env.LLM_SETTINGS_DIR;
    else process.env.LLM_SETTINGS_DIR = previous;
  }
});

test("New API /v1/models becomes the picker and drops non-chat ids", async () => {
  resetLlmCatalogCache();
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          { id: "deepseek-flash" },
          { id: "step-5-preview" },
          { id: "stepaudio-3-tts" },
          { id: "deepseek-chat" },
        ],
      }),
    );
  });
  const port = await listen(upstream);
  const root = mkdtempSync(path.join(tmpdir(), "neo-catalog-newapi-"));
  const previousDir = process.env.LLM_SETTINGS_DIR;
  process.env.LLM_SETTINGS_DIR = root;
  writeLlmSettings(
    {
      upstream: "deepseek",
      apiKey: "sk-catalog",
      model: "deepseek-flash",
      baseUrl: `http://127.0.0.1:${port}/v1`,
    },
    root,
  );
  try {
    const published = await publishedLlmSettings();
    assert.equal(published.modelsSource, "newapi");
    assert.deepEqual(
      published.models.map((item) => item.id),
      ["deepseek-flash", "step-5-preview"],
    );
  } finally {
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    if (previousDir === undefined) delete process.env.LLM_SETTINGS_DIR;
    else process.env.LLM_SETTINGS_DIR = previousDir;
    resetLlmCatalogCache();
  }
});
