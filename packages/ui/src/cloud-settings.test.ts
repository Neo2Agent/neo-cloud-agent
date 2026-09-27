import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "cloud-settings.tsx"), "utf8");
const css = readFileSync(path.join(here, "cloud-settings.css"), "utf8");

test("shared cloud settings cover GitHub MCP quota notify and env", () => {
  assert.match(src, /export function CloudAccountSettings/);
  assert.match(src, /\/v1\/integrations\/github/);
  assert.match(src, /\/v1\/settings\/quota/);
  assert.match(src, /\/v1\/settings\/mcp/);
  assert.match(src, /\/v1\/settings\/notify/);
  assert.match(src, /id="environment"/);
  assert.match(src, /id="build"/);
  assert.match(css, /\.settings-group\s*\{/);
});
