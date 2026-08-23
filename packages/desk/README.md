# Neo Desk

Electron 壳，渲染进程复用 `packages/web`。本机执行走同一份 `packages/worker`（loop 与工具同址）。

```bash
# 在仓库根
export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"
# 浏览器预览（不装 Electron）：Desk 自己占 :8082，Web 仍是 :8080
pnpm --filter @neo-cloud-agent/web --config.engine-strict=false build
NEO_CONTROL_PLANE_URL=http://127.0.0.1:8080 pnpm --filter @neo-cloud-agent/desk preview

# Electron 壳。若 Desk UI 已在 :8082：
pnpm add -D electron --filter @neo-cloud-agent/desk
NEO_CONTROL_PLANE_URL=http://127.0.0.1:8080 NEO_DESK_URL=http://127.0.0.1:8082 pnpm --filter @neo-cloud-agent/desk start
```

`preview` 会反代控制面、给页面注入 `window.neoDesk`（`canRunLocal: true`），并跑和 Electron 一样的 lease / fork worker。Token 走 `safeStorage`（Electron）或 Desk 预览进程内存；不进 `localStorage` 作为权威副本。Provider Key 仍只保存在控制面。
