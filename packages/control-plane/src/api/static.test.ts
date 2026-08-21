import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveWebFile, WEB_ROOT, webRoot } from "./static.js";

function ensureWebBuild(): void {
  const index = path.join(webRoot(), "index.html");
  const built = existsSync(index) && readFileSync(index, "utf8").includes("root") && !readFileSync(index, "utf8").includes("/src/main.tsx");
  if (built) {
    return;
  }
  const result = spawnSync(
    "pnpm",
    ["--filter", "@neo-cloud-agent/web", "--config.engine-strict=false", "build"],
    {
      cwd: path.resolve(WEB_ROOT, "../.."),
      encoding: "utf8",
      env: { ...process.env, PNPM_IGNORE_ENGINE: "1" },
    },
  );
  // WEB_ROOT is packages/web, repo root is two levels up.
  assert.equal(result.status, 0, result.stderr || result.stdout || "web build failed");
}

function readBuilt(name: string): string {
  ensureWebBuild();
  const file = resolveWebFile(name);
  assert.ok(file, `missing ${name}`);
  return readFileSync(file, "utf8");
}

function readBuiltAsset(ext: string): string {
  ensureWebBuild();
  const assets = path.join(webRoot(), "assets");
  const file = readdirSync(assets).find((item) => item.endsWith(ext));
  assert.ok(file, `missing ${ext} asset`);
  return readFileSync(path.join(assets, file), "utf8");
}

test("serves the chat index and rejects path traversal", () => {
  const index = resolveWebFile("/");
  assert.ok(index);
  assert.equal(path.basename(index), "index.html");
  const html = readBuilt("/");
  assert.match(html, /Neo Cloud Agent/);
  assert.match(html, /id="root"/);
  const cssText = readBuiltAsset(".css");
  assert.match(cssText, /--bg:\s*#ffffff/);
  assert.match(cssText, /color-scheme:\s*light/);
  assert.match(cssText, /\[hidden\]\{[^}]*display:\s*none\s*!important/);
  assert.match(cssText, /\.auth-gate:not\(\[hidden\]\)/);
  assert.match(cssText, /\.app\{[^}]*overflow:\s*hidden/);
  assert.match(cssText, /\.transcript\{[^}]*min-height:\s*0/);
  assert.match(cssText, /\.transcript\{[^}]*overflow-y:\s*auto/);
  assert.match(cssText, /\.composer\{[^}]*flex-shrink:\s*0/);
  const appText = readBuiltAsset(".js");
  assert.match(appText, /requestSubmit/);
  assert.match(appText, /登录响应缺少会话|登录未生效/);
  assert.match(appText, /\/v1\/settings\/llm/);
  assert.match(appText, /\/v1\/vms/);
  assert.match(appText, /slot-/);
  assert.match(appText, /加载更早的消息/);
  assert.match(appText, /环境/);
  assert.match(appText, /快照/);
  assert.match(appText, /API Key/);
  assert.match(appText, /save-llm/);
  assert.match(appText, /vm-status/);
  assert.match(appText, /toggle-settings/);
  assert.match(appText, /vm-rail/);
  assert.match(appText, /vm-badge/);
  assert.match(appText, /sidebar-toggle/);
  assert.match(appText, /tool-diff|diff-add/);
  assert.match(appText, /artifact/);
  assert.match(appText, /settings-panel/);
  assert.match(appText, /auth-email/);
  assert.match(appText, /novalidate|noValidate/);
  assert.doesNotMatch(html, /Fraunces/);
  assert.doesNotMatch(cssText, /#0b0[0-9a-f]{3}\b/);
  assert.equal(resolveWebFile("/../package.json"), null);
  assert.equal(resolveWebFile("/no-such-file"), null);
});

test("web assets live next to the control-plane package", () => {
  assert.ok(WEB_ROOT.endsWith(`${path.sep}web`) || WEB_ROOT.endsWith(`${path.sep}dist`));
});
