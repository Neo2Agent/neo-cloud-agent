import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "styles.css"), "utf8");
const tokens = readFileSync(path.join(here, "../../ui/src/tokens.css"), "utf8");

test("web shell uses the quiet monochrome workspace", () => {
  assert.match(css, /@import "@neo-cloud-agent\/ui\/tokens\.css"/);
  assert.match(tokens, /--bg:\s*#f4f4f5/);
  assert.match(tokens, /--accent:\s*#1c1c1c/);
  assert.match(css, /font-family:\s*var\(--font-sans\)/);
  assert.doesNotMatch(css, /#4d6bfe/);
  assert.match(css, /\.new-chat-plus\s*\{/);
  assert.match(css, /button\.send\s*\{[^}]*padding:\s*8px 16px/);
  assert.match(tokens, /--ease:\s*140ms ease/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /\.toast-host/);
  assert.match(css, /\.settings-group/);
  assert.match(css, /\.repo-bind-menu/);
  assert.match(css, /\.repo-bind-menu\s*\{[^}]*width:\s*min\(300px/);
  assert.match(css, /\.repo-bind-github-head\s*\{[^}]*flex:\s*none/);
  assert.match(css, /\.repo-bind-body\s*\{[^}]*max-height:\s*min\(280px/);
  assert.match(css, /\.repo-bind-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.repo-bind-search\s*\{[^}]*margin:\s*0 6px 4px/);
  assert.match(css, /\.repo-bind-search\s*\{[^}]*padding:\s*0 10px/);
  assert.match(css, /\.repo-bind-menu button\s*\{[^}]*padding:\s*6px 10px/);
  assert.match(css, /\.repo-bind-back\s*\{[^}]*margin:\s*0 6px/);
  assert.match(css, /\.repo-bind-menu \.repo-bind-row-icon\s*\{[^}]*width:\s*16px/);
  assert.match(css, /\.repo-bind-menu \.repo-bind-row-icon\s*\{[^}]*height:\s*16px/);
  assert.match(css, /\.repo-bind-trigger/);
  assert.match(css, /\.repo-bind-item-name/);
  assert.match(css, /\.run-folder-head/);
  assert.match(css, /\.run-section-head/);
  assert.match(css, /\.term-shell\s*\{/);
  assert.match(css, /@import "@neo-cloud-agent\/ui\/context-usage\.css"/);
  assert.match(css, /\.palette-backdrop\s*\{/);
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
