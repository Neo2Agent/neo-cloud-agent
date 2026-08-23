# Neo Desk

Electron 壳，渲染进程复用 `packages/web`。本机执行走同一份 `packages/worker`（loop 与工具同址）。

```bash
# 在仓库根
export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"
pnpm add -D electron --filter @neo-cloud-agent/desk
NEO_CONTROL_PLANE_URL=http://127.0.0.1:8080 pnpm --filter @neo-cloud-agent/desk start
```

登录后主进程会 `POST /v1/desks` 登记本机，长轮询 lease，认领后 `fork` worker。Token 走 `safeStorage`，不进 `localStorage` 作为权威副本。Provider Key 仍只保存在控制面。
