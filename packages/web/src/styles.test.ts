import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

test("web shell keeps the original cool-gray chrome", () => {
  assert.match(css, /--bg:\s*#ffffff/);
  assert.match(css, /--accent:\s*#4d6bfe/);
  assert.match(css, /font-family:\s*Inter/);
  assert.doesNotMatch(css, /Geist Sans/);
  assert.match(css, /\.new-chat-plus\s*\{/);
  assert.match(css, /button\.send\s*\{[^}]*padding:\s*8px 16px/);
  assert.match(css, /--ease:\s*140ms ease/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /\.toast-host/);
  assert.match(css, /\.settings-group/);
  assert.match(css, /\.term-shell\s*\{/);
});

test("welcome cluster fits a 14-inch laptop viewport without a page scroll", () => {
  assert.match(css, /\.transcript\s*\{[^}]*container-name:\s*transcript/);
  assert.match(css, /\.empty h2\s*\{[^}]*margin:\s*0 0 8px/);
  assert.match(css, /\.empty p\s*\{[^}]*margin:\s*0/);
  assert.match(css, /@media \(min-width: 861px\)\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 861px\) and \(max-height: 920px\)/);
  assert.match(css, /@media \(min-width: 861px\) and \(max-height: 760px\)/);
  assert.match(css, /@media \(min-width: 1400px\)/);
  assert.match(css, /@container transcript \(max-height: 560px\)/);
  assert.match(css, /@container transcript \(max-height: 420px\)/);
});
