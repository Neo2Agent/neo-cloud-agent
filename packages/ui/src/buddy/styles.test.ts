import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

test("buddy composer bar keeps Flash centered between plus/mic and send", () => {
  assert.match(css, /\.buddy-composer-bar\s*\{[^}]*grid-template-columns:\s*1fr auto 1fr/);
  assert.match(css, /\.buddy-composer-bar-start\s*\{/);
  assert.match(css, /\.buddy-composer-bar-end\s*\{/);
});

test("buddy home shrinks the mascot on short laptop or landscape viewports", () => {
  assert.match(css, /@media \(max-height: 760px\)/);
  assert.match(css, /\.buddy-home-hero\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.buddy-mascot:not\(\.is-compact\)\s*\{[^}]*width:\s*96px/);
});
