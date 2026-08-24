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
  assert.match(cssText, /\.context-usage-pop/);
  assert.match(cssText, /\.context-usage-bar/);
  const appText = readBuiltAsset(".js");
  assert.match(appText, /requestSubmit/);
  assert.match(appText, /登录响应缺少会话|登录未生效/);
  assert.match(appText, /\/v1\/settings\/llm/);
  assert.match(appText, /\/v1\/settings\/scm/);
  assert.match(appText, /GitHub PAT/);
  assert.match(appText, /save-scm/);
  assert.match(appText, /\/v1\/vms/);
  assert.match(appText, /slot-/);
  assert.match(appText, /加载更早的消息/);
  assert.match(appText, /对话页刚才崩了/);
  assert.match(appText, /chat-crash-retry/);
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
  assert.match(appText, /type===["']tool["']/);
  assert.match(appText, /tool-stack/);
  assert.match(appText, /artifact/);
  assert.match(appText, /deepseek-v4-flash/);
  assert.match(appText, /文件树/);
  assert.match(appText, /归档/);
  assert.match(appText, /settings-panel/);
  assert.match(appText, /workspace-drawer/);
  assert.match(appText, /auth-email/);
  assert.match(appText, /novalidate|noValidate/);
  assert.match(appText, /turn-progress/);
  assert.match(appText, /正在思考/);
  assert.match(appText, /stop-icon/);
  assert.match(appText, /停止失败/);
  assert.match(appText, /context-usage/);
  assert.match(appText, /上下文用量/);
  assert.match(appText, /窗口未知/);
  assert.match(appText, /系统提示/);
  assert.match(appText, /工具定义/);
  assert.match(appText, /已压缩对话/);
  assert.match(cssText, /pulse-dot/);
  assert.match(cssText, /think-bounce/);
  assert.match(cssText, /\.run-time/);
  assert.match(cssText, /\.bubble-time/);
  assert.match(appText, /创建 /);
  assert.match(appText, /完成 /);
  assert.match(cssText, /\.workspace-drawer\{[^}]*max-height:\s*min\(48vh/);
  assert.match(cssText, /\.main\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(cssText, /\.main\{[^}]*grid-template-areas/);
  assert.match(cssText, /#root\{[^}]*overflow:\s*hidden/);
  assert.match(cssText, /\.workspace-col\{[^}]*grid-area:\s*workspace/);
  assert.match(cssText, /\.composer\{[^}]*grid-area:\s*composer/);
  assert.doesNotMatch(html, /Fraunces/);
  assert.doesNotMatch(cssText, /#0b0[0-9a-f]{3}\b/);
  assert.equal(resolveWebFile("/../package.json"), null);
  assert.equal(resolveWebFile("/no-such-file"), null);
});

test("web assets live next to the control-plane package", () => {
  assert.ok(WEB_ROOT.endsWith(`${path.sep}web`) || WEB_ROOT.endsWith(`${path.sep}dist`));
});
