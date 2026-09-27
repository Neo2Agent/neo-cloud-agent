import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "setup-fail.css"), "utf8");
const src = readFileSync(path.join(here, "setup-fail.tsx"), "utf8");

test("shared setup-fail banner keeps the Web inline log", () => {
  assert.match(src, /export function SetupFailBanner/);
  assert.match(src, /setupDiagToggleLabel/);
  assert.match(src, /setupFailLogText/);
  assert.doesNotMatch(css, /\.setup-fail\.is-sticky/);
  assert.match(css, /\.setup-fail-log\s*\{[^}]*max-height:\s*220px/);
  assert.match(css, /\.setup-fail-log\s*\{[^}]*white-space:\s*pre-wrap/);
});
