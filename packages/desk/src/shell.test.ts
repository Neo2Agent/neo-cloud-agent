import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));

test("Desk Electron wraps packages/web instead of the leftover desk/ui Vite", () => {
  const dev = readFileSync(path.join(here, "../scripts/dev.ts"), "utf8");
  const pack = readFileSync(path.join(here, "../scripts/pack.ts"), "utf8");
  const docs = readFileSync(path.join(here, "../../../docs/desk.md"), "utf8");
  const preload = readFileSync(path.join(here, "../app/preload.cjs"), "utf8");
  assert.match(dev, /ensureWebUi/);
  assert.doesNotMatch(dev, /ui\/vite\.config\.ts/);
  assert.match(pack, /@neo-cloud-agent\/web/);
  assert.match(pack, /packages\/web\/dist/);
  assert.doesNotMatch(pack, /vite", "build", "--config", "ui\/vite\.config\.ts/);
  assert.match(docs, /Electron 套 Web/);
  assert.match(preload, /onDeepLink:/);
  assert.match(preload, /notify:/);
});
