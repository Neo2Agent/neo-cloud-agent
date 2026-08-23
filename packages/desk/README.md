# Neo Desk

Electron 桌面客户端。渲染进程复用 `packages/web` 的 Vite 产物（`neo-desk://` 本地加载），本机执行走同一份 `packages/worker`（loop 与工具同址）。

锁定设计（`docs/desk.md` 设计分支）写明：对齐的是 Cursor **Agents Window 的交互语义**（本机/云端目标、侧栏置顶、会话标签、快捷键），不是复刻 Cursor 整份 IDE。没有编辑器；Desk 本身就是 Agents Window。

```bash
# 在仓库根
export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"
pnpm --filter @neo-cloud-agent/web --config.engine-strict=false build
NEO_CONTROL_PLANE_URL=http://127.0.0.1:8080 pnpm --filter @neo-cloud-agent/desk compile
NEO_CONTROL_PLANE_URL=http://127.0.0.1:8080 pnpm --filter @neo-cloud-agent/desk start
```

登录后主进程会 `POST /v1/desks` 登记本机，长轮询 lease，认领后 `fork` worker。Token 走 `safeStorage`，不进 `localStorage` 作为权威副本。Provider Key 仍只保存在控制面。

浏览器预览 `pnpm --filter @neo-cloud-agent/desk preview`（:8082）只是没有图形会话时的兜底，不是客户端本体。
