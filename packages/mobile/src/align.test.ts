import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ISLAND } from "./island-theme.ts";
import { THEME } from "@neo-cloud-agent/ui/tokens";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "island.css"), "utf8");

test("mobile lab uses the shared Web monochrome tokens", () => {
  assert.equal(ISLAND.accent, THEME.accent);
  assert.equal(ISLAND.bg, THEME.bg);
  assert.notEqual(ISLAND.accent, "#19c8b9");
  assert.match(css, /@import "@neo-cloud-agent\/ui\/tokens\.css"/);
  assert.match(css, /@import "@neo-cloud-agent\/ui\/git-panel\.css"/);
  assert.match(css, /font:\s*16px\/1.45 var\(--font-sans\)/);
  assert.match(css, /\.composer-context\s*\{/);
  assert.match(css, /\.composer-box,/);
  assert.match(css, /\.composer-pickers\s*\{/);
  assert.match(css, /\.composer-repo select/);
  assert.match(css, /\.chat-head-pop/);
  assert.match(css, /\.work-fold\s*,/);
  assert.match(css, /@import "@neo-cloud-agent\/ui\/context-usage\.css"/);
  assert.match(css, /\.work-fold-body\s*\{/);
  assert.match(css, /\.artifact-chip\s*\{/);
});

test("mobile web App keeps hooks before login returns", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "web/App.tsx"), "utf8");
  const body = src.slice(src.indexOf("export function App"));
  const early = body.indexOf("if (!ready)");
  const lastMemo = body.lastIndexOf("useMemo(");
  assert.ok(early > 0, "ready gate is present");
  assert.ok(lastMemo > 0 && lastMemo < early, "useMemo must run before the ready/login returns");
});
