import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "styles.css"), "utf8");
const tokens = readFileSync(path.join(here, "../../ui/src/tokens.css"), "utf8");

test("desk chrome imports the shared Web monochrome tokens", () => {
  assert.match(css, /@import "@neo-cloud-agent\/ui\/tokens\.css"/);
  assert.match(css, /@import "@neo-cloud-agent\/ui\/git-panel\.css"/);
  assert.match(css, /font-family:\s*var\(--font-sans\)/);
  assert.doesNotMatch(css, /--accent:\s*#19c8b9/);
  assert.doesNotMatch(css, /#794f27/);
  assert.match(tokens, /--bg:\s*#f4f4f5/);
});

test("desk composer is the Cursor / Web box: + pickers left, circular send", () => {
  assert.match(css, /\.composer-pickers\s*\{/);
  assert.match(css, /\.composer-attach\s*\{/);
  assert.match(css, /\.composer-queue\s*\{/);
  assert.match(css, /\.send-btn\s*\{[^}]*border-radius:\s*50%/);
  assert.match(css, /@import "@neo-cloud-agent\/ui\/context-usage\.css"/);
});
