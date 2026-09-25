import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { THEME } from "./tokens.ts";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

test("shared chrome also ships the Web context-usage chip", () => {
  const usage = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "context-usage.css"), "utf8");
  assert.match(usage, /\.context-usage-chip\s*\{/);
});

test("shared tokens are the Web monochrome workspace", () => {
  assert.equal(THEME.bg, "#f4f4f5");
  assert.equal(THEME.accent, "#1c1c1c");
  assert.equal(THEME.err, "#b42318");
  assert.match(css, /--bg:\s*#f4f4f5/);
  assert.match(css, /--accent:\s*#1c1c1c/);
  assert.match(css, /--font-sans:\s*"Geist Sans"/);
  assert.doesNotMatch(css, /#4d6bfe/);
  assert.doesNotMatch(css, /#19c8b9/);
  assert.doesNotMatch(css, /#794f27/);
  assert.match(css, /--paper-grain:\s*none/);
  assert.match(css, /--wood-grain:\s*none/);
});
