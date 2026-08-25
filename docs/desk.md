# Neo Desk

设计原文见先前的 desk-client-design 分支。这里只记**已经落地**的部分。

## 不变量

1. `ExecutionTarget { loop, tools }` 两轴分开写，P0–P2 只允许 `loop === tools`。
2. Provider Key 只在 gateway。Desk 只有 run JWT / 用户 session。
3. 会话权威在控制面。桌面不做本地会话库。

## 已落地

| 期 | 内容 |
| --- | --- |
| P0-A | `KillMode=process`；worker 按工具次数 / 时间增量备份 session；`detachOrQueue` 把未完成 prompt 放回 inbox |
| P0-B | `packages/desk` Electron 壳 + **独立 Desk UI**（`packages/desk/ui`，不复用 Web 壳） |
| P1 | 侧栏置顶/分组；对话 / Diff / 终端 / 产物标签；composer 上的目标 / 模式 / 模型；`Ctrl+Enter` 排队；Diff 页可提交；`Cmd+W` 关会话 |
| P2 | `/v1/desks` 登记 + lease/claim；`DeskRuntime`；`POST /v1/runs` 的 `target`；双向 handoff（干净 clone，UI 写明未提交改动不跟随） |

## 本机 Run 路径

1. Desk 登录后 `POST /v1/desks`，拿 `deskId` + desk token。
2. `POST /v1/desks/:id/lease` 长轮询。
3. 用户选本机目标并选 git 文件夹后 `POST /v1/runs { target: { loop: "desk", tools: "desk", deskId } }`。
4. Desk 开 worktree、写 `.neo/run-bootstrap.json`、`fork` `packages/worker`，再 `claim`。
5. 掉线走现有 `detachOrQueue`，不标 ERROR。

```bash
pnpm dev:web        # Web UI :5173，API :8080
pnpm dev:desk       # 独立 Desk UI :5174 + Electron → 本地 :8080
pnpm dev:desk:prod  # 同一套 Desk UI → 线上控制面（默认 http://62.234.211.200，也可用 http://neorun.cloud），不启本地后端
```

Web 和 Desk 共用控制面 / gateway / worker，UI 分包：`packages/web` 与 `packages/desk/ui`。

未做：P3 并排窗格 / SSH 远程机；云 loop + 本机工具 RPC（见设计 §12）。
