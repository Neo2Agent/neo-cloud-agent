import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  acceptsGzip,
  isHashedWebAsset,
  resolveArchitectureFile,
  resolveWebFile,
  serveWebFile,
  WEB_ROOT,
  webCacheControl,
  webRoot,
} from "./static.js";

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
  const files = readdirSync(assets).filter((item) => item.endsWith(ext));
  assert.ok(files.length > 0, `missing ${ext} asset`);
  return files.map((file) => readFileSync(path.join(assets, file), "utf8")).join("\n");
}

test("serves the chat index and rejects path traversal", () => {
  const index = resolveWebFile("/");
  assert.ok(index);
  assert.equal(path.basename(index), "index.html");
  const html = readBuilt("/");
  assert.match(html, /Neo Cloud Agent/);
  assert.match(html, /id="root"/);
  assert.match(html, /正在进入/);
  assert.match(html, /boot-splash/);
  const cssText = readBuiltAsset(".css");
  assert.match(cssText, /--bg:\s*#ffffff/);
  assert.match(cssText, /--accent:\s*#4d6bfe/);
  assert.match(cssText, /font-family:\s*Inter/);
  assert.doesNotMatch(cssText, /Geist Sans/);
  assert.match(cssText, /\.new-chat-plus/);
  assert.match(cssText, /color-scheme:\s*light/);
  assert.match(cssText, /\[hidden\]\{[^}]*display:\s*none\s*!important/);
  assert.match(cssText, /\.auth-gate:not\(\[hidden\]\)/);
  assert.match(cssText, /\.app\{[^}]*overflow:\s*hidden/);
  assert.match(cssText, /\.transcript\{[^}]*min-height:\s*0/);
  assert.match(cssText, /\.transcript\{[^}]*overflow-y:\s*auto/);
  assert.match(cssText, /\.transcript\{[^}]*container-name:\s*transcript/);
  assert.match(cssText, /@media\s*\(min-width:\s*861px\)\s*and\s*\(max-height:\s*920px\)/);
  assert.match(cssText, /repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(cssText, /@container transcript\s*\(max-height:\s*560px\)/);

  assert.match(cssText, /\.composer\{[^}]*flex-shrink:\s*0/);
  assert.match(cssText, /\.context-usage-pop/);
  assert.match(cssText, /\.context-usage-bar/);
  const appText = readBuiltAsset(".js");
  assert.match(appText, /requestSubmit/);
  assert.match(appText, /登录响应缺少会话|登录未生效/);
  assert.match(appText, /neo_sess_/);
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
  assert.match(appText, /工作区/);
  assert.match(appText, /置顶/);
  assert.match(appText, /session-tabs/);
  assert.match(appText, /产物/);
  assert.match(appText, /保存到项目/);
  assert.match(appText, /存入项目/);
  assert.match(appText, /关闭预览/);
  assert.match(appText, /artifact-row/);
  assert.match(appText, /项目资产/);
  assert.match(appText, /#\/projects\//);
  assert.match(appText, /归档/);
  assert.match(appText, /settings-panel/);
  assert.match(appText, /settings-page|#\/settings/);
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
  assert.match(appText, /规则/);
  assert.match(appText, /记忆/);
  assert.match(appText, /技能目录/);
  assert.match(appText, /内置工具/);
  assert.match(appText, /云端工具/);
  assert.match(appText, /已压缩对话/);
  assert.match(cssText, /pulse-dot/);
  assert.match(cssText, /think-bounce/);
  assert.match(cssText, /\.run-time/);
  assert.match(cssText, /\.bubble-time/);
  assert.match(appText, /创建 /);
  assert.match(appText, /完成 /);
  assert.match(cssText, /\.settings-group/);
  assert.match(cssText, /\.toast-host/);
  assert.match(cssText, /\.main\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(cssText, /\.main\{[^}]*grid-template-areas/);
  assert.match(cssText, /#root\{[^}]*overflow:\s*hidden/);
  assert.match(cssText, /\.quiet-btn/);
  assert.match(cssText, /\.proj-assets/);
  assert.match(cssText, /\.artifact-row/);
  assert.match(cssText, /\.artifact-preview-empty/);
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

test("hashed assets are cached; html stays no-cache", () => {
  assert.equal(webCacheControl("/tmp/assets/index-Dszq1uEl.js"), "public, max-age=31536000, immutable");
  assert.equal(webCacheControl("/tmp/assets/index-mpF7L9gG.css"), "public, max-age=31536000, immutable");
  assert.equal(webCacheControl("/tmp/index.html"), "no-cache");
  assert.equal(webCacheControl("/tmp/src/main.tsx"), "public, max-age=86400");
  assert.equal(isHashedWebAsset("index-Dszq1uEl.js"), true);
  assert.equal(isHashedWebAsset("index.html"), false);
  assert.equal(acceptsGzip({ headers: { "accept-encoding": "gzip, deflate" } } as never), true);
  assert.equal(acceptsGzip({ headers: {} } as never), false);
});

function rawGet(url: string, headers: Record<string, string>): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("control-plane gzips hashed JS when the browser asks", async () => {
  ensureWebBuild();
  const assets = path.join(webRoot(), "assets");
  const jsName = readdirSync(assets).find((item) => item.endsWith(".js") && isHashedWebAsset(item));
  assert.ok(jsName, "missing hashed js");
  const server = createServer((req, res) => {
    if (!serveWebFile(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const gzipped = await rawGet(`http://127.0.0.1:${port}/assets/${jsName}`, { "accept-encoding": "gzip" });
    assert.equal(gzipped.status, 200);
    assert.equal(gzipped.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.equal(gzipped.headers["content-encoding"], "gzip");
    const decoded = gunzipSync(gzipped.body).toString("utf8");
    assert.match(decoded, /createRoot|React/);
    assert.ok(gzipped.body.length < decoded.length);
    const html = await rawGet(`http://127.0.0.1:${port}/`, {});
    assert.equal(html.headers["cache-control"], "no-cache");
    assert.match(html.body.toString("utf8"), /正在进入/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("serves the architecture poster at /architecture without a web build", async () => {
  const file = resolveArchitectureFile("/architecture");
  assert.ok(file);
  assert.equal(path.basename(file), "architecture-complete.html");
  assert.equal(resolveArchitectureFile("/architecture.html"), file);
  assert.equal(resolveArchitectureFile("/architecture-complete.html"), file);
  assert.equal(resolveArchitectureFile("/"), null);
  const html = readFileSync(file, "utf8");
  assert.match(html, /Neo Cloud Agent 完整架构图/);
  assert.match(html, /llm-gateway/);

  const server = createServer((req, res) => {
    if (!serveWebFile(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const page = await rawGet(`http://127.0.0.1:${port}/architecture`, {});
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-type"]), /text\/html/);
    assert.match(page.body.toString("utf8"), /控制面/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
