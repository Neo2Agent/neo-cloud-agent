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
  assert.match(readFileSync(index, "utf8"), /环境/);
  assert.match(readFileSync(index, "utf8"), /快照/);
  assert.match(readFileSync(index, "utf8"), /novalidate/);
  assert.match(readFileSync(index, "utf8"), /id="auth-email"[^>]*type="text"/);
  assert.match(readFileSync(index, "utf8"), /id="auth-submit">登录</);
  assert.match(readFileSync(index, "utf8"), /API Key/);
  assert.match(readFileSync(index, "utf8"), /id="save-llm"/);
  assert.match(readFileSync(index, "utf8"), /id="vm-status"/);
  const css = resolveWebFile("/styles.css");
  assert.ok(css);
  const cssText = readFileSync(css, "utf8");
  assert.match(cssText, /--bg: #ffffff/);
  assert.match(cssText, /color-scheme: light/);
  assert.match(cssText, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(cssText, /\.auth-gate:not\(\[hidden\]\)/);
  const app = resolveWebFile("/app.js");
  assert.ok(app);
  const appText = readFileSync(app, "utf8");
  assert.match(appText, /requestSubmit/);
  assert.match(appText, /登录响应缺少会话|登录未生效/);
  assert.match(appText, /\/v1\/settings\/llm/);
  assert.match(appText, /vmSlots/);
  assert.doesNotMatch(readFileSync(index, "utf8"), /Fraunces/);
  assert.doesNotMatch(readFileSync(css, "utf8"), /#0b0[0-9a-f]{3}\b/);
  assert.equal(resolveWebFile("/../package.json"), null);
  assert.equal(resolveWebFile("/no-such-file"), null);
});

test("web assets live next to the control-plane package", () => {
  assert.ok(WEB_ROOT.endsWith(`${path.sep}web`));
});
