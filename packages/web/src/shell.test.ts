import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));

test("Web vite can serve the phone shell on another port", () => {
  const vite = readFileSync(path.join(here, "../vite.config.ts"), "utf8");
  const main = readFileSync(path.join(here, "main.tsx"), "utf8");
  const mobile = readFileSync(path.join(here, "../../../scripts/dev-mobile.ts"), "utf8");
  assert.match(vite, /NEO_WEB_PORT/);
  assert.match(vite, /NEO_SHELL/);
  assert.match(vite, /data-neo-shell="mobile"/);
  assert.match(main, /dataset.neoShell = "mobile"/);
  assert.match(mobile, /shell: "mobile"/);
  assert.match(mobile, /DEFAULT_MOBILE_UI_PORT/);
});
