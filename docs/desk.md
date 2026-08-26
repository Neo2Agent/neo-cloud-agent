# Neo Desk

独立 Electron 客户端。和 Web **共用控制面 / gateway / worker**，UI 在 `packages/desk/ui`，**不复用** `packages/web` 那套浅色壳。

对标 Cursor **Agents Window**（This Computer / Cloud / Remote），不是对话页的 Diff / 终端 / 产物三标签。

项目协同的对象和阶段见 [desk-project-design.md](./desk-project-design.md)。总图见 [architecture-overview.md](./architecture-overview.md)。

## 不变量

1. `ExecutionTarget { loop, tools }` 两轴分开写，P0–P2 只允许 `loop === tools`。
2. Provider Key 只在 gateway。Desk 只有用户 session 和 run JWT。
3. **会话权威在控制面。** 桌面不做本地会话库、本地项目库、本地待办库。
4. **项目只存在于云端。** `POST /v1/projects` 建的是控制面项目；本机 git 目录只是 This Computer 这条 Run 的工作区，不是项目。
5. **项目资产只由用户手动上云。** 工作区文件不会自动进项目盘；Agent `neo_artifact_upload` 只进该 Run 的产物。

## 壳与开发入口

| 路径 | 做什么 |
| --- | --- |
| `pnpm dev:desk` | Vite `:5174` + Electron，API 打本地 `:8080` |
| `pnpm dev:desk:prod` | 同一窗口，API 打现网控制面，不启本地后端 |
| `pnpm dev:desk:two` | 两个 Electron 窗（两套 `userData`），方便测协作 |
| 打好的 `ui/dist` | 主进程用 `neo-desk://app/` 加载，不再回退到控制面或浏览器预览 |

旧的 `pnpm preview:desk`（`:8082` 把 `packages/web/dist` 注入假 `neoDesk`）已删除。没有 `NEO_DESK_URL` 且没有 `ui/dist` 时，窗口直接报错。

登录账号和 Web 相同，必须手输，不预填。

## 已落地的界面

主舞台是 **一条 transcript + 底部 composer**，没有 Web 那种 Diff / 终端 / 产物顶栏。

左侧 rail：

- New Chat / Search / Automations / Projects
- **对话**：没有项目、也没有仓库路径的 Inbox
- **空间**：按云项目 / 本机目录 / git remote 分组
- 底栏：账号、收件箱小点、设置（Cloud / This Computer / 选 git 文件夹）

点项目进入工作台，默认停在 **任务**（不是单独的「概览」页）。标签是：任务 / 对话 / 资产 / 动态（含留言）/ 设置。

打开一条会话：

- 无 `projectId` → `PersonalChatPage`
- 有 `projectId` → `ProjectChatPage`（项目面包屑、转交、流转待办；**仅云端**可邀请加入这条对话）

`Cmd+W` 关当前会话。本机目标在 composer 上选 This Computer，并先授权一个 git 仓库。

## 已落地的执行面

| 期 | 内容 |
| --- | --- |
| P0 | `KillMode=process`；worker 增量备份 session；`detachOrQueue`；独立 Electron + Desk UI |
| P1 | Agents Window 壳：侧栏对话/空间、composer 上的 Cloud / This Computer / 模型、`Cmd+W` |
| P2 | `/v1/desks` 登记 + lease/claim；`DeskRuntime`；`POST /v1/runs` 的 `target`；双向 handoff（干净 clone，未提交改动不跟随） |

未做（刻意）：P3 并排窗格 / SSH 远程机；云 loop + 本机工具 RPC。

## 本机执行对话（客户端）

本机对话和云对话共用同一套 UI 与 `/v1`。差别只在 **worker 在哪台机器上 fork**。

```text
渲染进程（Desk UI）
  选 This Computer + git 文件夹
  POST /v1/runs { source: "desk", target: { loop: "desk", tools: "desk", deskId } }
  订 GET /v1/runs/:id/events（和云对话一样）

主进程（host.ts）
  登录后 POST /v1/desks → deskId + desk token（写 userData）
  POST /v1/desks/:id/lease 长轮询
  弹出授权（Agent 会改这个仓库）
  git worktree add <repo>/.neo/worktrees/<runId前8位>
  写 .neo/run-bootstrap.json
  fork packages/worker（剥掉 Provider Key）
  POST /v1/desks/:id/claim { workspaceDir, pid }

控制面
  DeskRuntime 不 spawn，只 adopt(pid)
  掉线 detachOrQueue，不标 ERROR
```

客户端约束（已经写进代码）：

- 只允许带 `.git` 的文件夹；授权名单存在 `userData/folders.json`
- `repoUrls` 对本机 Run 是本地路径，出现在侧栏「空间」，**不把绝对路径同步成别人的项目默认仓库**
- 本机 Run **没有**「邀请加入这条对话」。一起干活要开 Cloud，或各开各的云端 Run
- 切到云端 handoff 需要可 clone 的远端；worktree 里未提交的改动不跟随
- 会话列表、transcript、跟进队列仍以控制面为准；关窗口不等于删对话

渲染进程看不到 Node、看不到磁盘，只通过 `window.neoDesk` 选目录和读写目标。

```bash
pnpm dev:web        # Web UI :5173，API :8080
pnpm dev:desk       # Desk UI :5174 + Electron → 本地 :8080
pnpm dev:desk:prod  # 同一套 Desk UI → 线上控制面
```
