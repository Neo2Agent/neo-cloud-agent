import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveWebFile, WEB_ROOT } from "./static.js";

test("serves the chat index and rejects path traversal", () => {
  const index = resolveWebFile("/");
  assert.ok(index);
  assert.equal(path.basename(index), "index.html");
  assert.match(readFileSync(index, "utf8"), /Neo Cloud Agent/);
  const css = resolveWebFile("/styles.css");
  assert.ok(css);
  assert.match(readFileSync(css, "utf8"), /--bg: #ffffff/);
  assert.equal(resolveWebFile("/../package.json"), null);
  assert.equal(resolveWebFile("/no-such-file"), null);
});

test("web assets live next to the control-plane package", () => {
  assert.ok(WEB_ROOT.endsWith(`${path.sep}web`));
});
