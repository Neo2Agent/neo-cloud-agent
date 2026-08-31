# Neo Desk

独立的 Electron 桌面客户端。和 Web **共用控制面 / gateway / worker**，但 **UI 是另一套**（`packages/desk/ui`），不再加载 `packages/web`。

```bash
# 仓库根。
export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"
pnpm dev:web        # Web UI :5173，打本地 :8080
pnpm dev:desk       # Desk Vite :5174 + Electron，打本地 :8080（没有就拉起）
pnpm dev:desk:prod  # 同一套 Desk UI，API 打线上控制面，不启本地 :8080
```

`dev:desk` 打开的是原生窗口，不是浏览器页。没有 `:8082` 预览。登录账号和 Web 相同，必须手输。

本地 `pnpm dev` / `pnpm dev:desk` 只连本机控制面（内存事件总线 + 本地 Run）。要和线上 MySQL / Redis / VM 槽是同一条总线，用 `pnpm dev:desk:prod`（默认 `http://62.234.211.200`）。备案期间域名也走 HTTP（`http://neorun.cloud`，不 308 到 HTTPS）；现网 443 仍可能被重置。

安装包：

```bash
pnpm pack:desk   # mac / Windows / Linux zip，默认连现网
```

产物在 `packages/desk/release/`。打开后手输现网账号。Cloud 对话走线上控制面；This Computer 需要包里的 `worker.cjs`。未签名的 macOS zip 要右键「打开」。

覆盖地址：`NEO_CONTROL_PLANE_URL=http://host pnpm dev:desk:prod`。`.env` 里的本地 `CONTROL_PLANE_URL` 不会把 prod 模式拽回 8080。

锁定设计里「对齐 Cursor」指 Agents Window 的交互（This Computer / Cloud / Remote），不是复用 Web 那套浅色壳。
