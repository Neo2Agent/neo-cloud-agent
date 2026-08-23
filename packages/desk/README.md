# Neo Desk

独立的 Electron 桌面客户端。和 Web **共用控制面 / gateway / worker**，但 **UI 是另一套**（`packages/desk/ui`），不再加载 `packages/web`。

```bash
# 仓库根。控制面已在 :8080 时会复用，否则自动拉起。
export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"
pnpm dev:web    # Web UI :5173，API :8080
pnpm dev:desk   # Desk UI Vite :5174 + Electron 窗口
```

`dev:desk` 打开的是原生窗口，不是浏览器页。登录账号和 Web 相同（默认 `admin` / `123456`）。

锁定设计里「对齐 Cursor」指 Agents Window 的交互（This Computer / Cloud / Remote），不是复用 Web 那套浅色壳。
