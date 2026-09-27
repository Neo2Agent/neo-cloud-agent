import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));

test("ensureWebUi is the shared Web/Desk/Mobile shell starter", () => {
  const src = readFileSync(path.join(here, "ensure-web.ts"), "utf8");
  const desk = readFileSync(path.join(here, "../packages/desk/scripts/dev.ts"), "utf8");
  const mobile = readFileSync(path.join(here, "dev-mobile.ts"), "utf8");
  assert.match(src, /DEFAULT_WEB_UI_PORT = 5173/);
  assert.match(src, /DEFAULT_MOBILE_UI_PORT = 5175/);
  assert.match(src, /@neo-cloud-agent\/web/);
  assert.match(desk, /ensureWebUi/);
  assert.match(mobile, /shell: "mobile"/);
});
