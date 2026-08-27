# Neo Desk

独立 Electron 客户端。和 Web **共用控制面 / gateway / worker**，UI 在 `packages/desk/ui`，**不复用** `packages/web` 那套浅色壳。

对标 Cursor **Agents Window**（This Computer / Cloud / Remote），不是对话页的 Diff / 终端 / 产物三标签。

项目协同的对象和阶段见 [desk-project-design.md](./desk-project-design.md)。总图见 [architecture-overview.md](./architecture-overview.md)。

## 不变量

1. `ExecutionTarget { loop, tools }` 两轴分开写，P0–P2 只允许 `loop === tools`。
2. Provider Key 只在 gateway。Desk 只有用户 session 和 run JWT。
3. **会话权威在控制面。** 桌面不做本地会话库、本地项目库、本地待办库。
4. **项目只存在于云端。** `POST /v1/projects` 建的是控制面项目；本机目录只是 This Computer 这条 Run 的工作区，不是项目。
5. **项目资产只由用户手动上云。** 工作区文件不会自动进项目盘；Agent `neo_artifact_upload` 只进该 Run 的产物。
6. **本机工作区就是用户选的那个文件夹。** 就地读写，不开旁路 worktree；写不出这个根。

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

`Cmd+W` 关当前会话。本机目标在 composer 上选 This Computer，并先授权一个文件夹。

## 右侧栏

右上角按钮开合，记住展开状态和停在哪个 tab。中间永远是对话，**不是** Web 那种「切到终端页就把对话切走」。

| tab | 本机 | 云端 |
| --- | --- | --- |
| Files | 主进程 IPC 列目录 / 预览 / 交给系统编辑器，锁在授权根 | `GET /v1/runs/:id/fs`，只读 |
| Terminal | 工作区根下的 shell，可多标签 | 命令输出 + setup 日志，标题写「输出」，**不能打字** |

**不做 IDE。** Files 只有树 + 只读预览，没有栏内编辑保存。要改文件：让 Agent 改，或自己在编辑器里改，Files 刷新即可。

两点如实说明：

- 本机终端是**管道 shell，不是 pty**。真终端设备要 native 模块，而本仓库 `onlyBuiltDependencies` 只放行 esbuild。命令、输出、输入都能用；需要 tty 的全屏 TUI 不行。`createLocalShell` 是留好的接缝。
- 云端交互式 PTY 没做（要另开一条打进 VM 的通道）。

## 已落地的执行面

| 期 | 内容 |
| --- | --- |
| P0 | `KillMode=process`；worker 增量备份 session；`detachOrQueue`；独立 Electron + Desk UI |
| P1 | Agents Window 壳：侧栏对话/空间、composer 上的 Cloud / This Computer / 模型、`Cmd+W` |
| P2 | `/v1/desks` 登记；inline 本地起 + dispatch 远程派；`DeskRuntime`；`POST /v1/runs` 的 `target`；双向 handoff（干净 clone，未提交改动不跟随）；右侧栏 Files / Terminal |

未做（刻意）：隔离 worktree、P3 并排窗格 / SSH 远程机、云 loop + 本机工具 RPC、云端交互 PTY、栏内编辑器。

## 两条本机路径

`start` 分开两件事：**谁起这个 worker**。

| | A `inline` | B `dispatch`（缺省） |
| --- | --- | --- |
| 谁发起 | 你就在这台 Desk 前面 | Web / handoff / 控制面恢复 |
| 怎么拿到任务 | 创建响应直接带 `assignment` | 走 Desk 自己开的 inbox 流 |
| 要不要绑定工作区 | 不要求，主进程知道自己授权了哪个 | **必须**，远程端不选路径 |
| 排队文案 | 「正在这台电脑上启动 Agent」 | 「已派给这台电脑，等待启动」 |

两条路径之后完全一样：同一个 `packages/worker`、同一个工作区、同一套沙箱、同一个右侧栏。

### A 本机执行

```text
渲染进程（Desk UI）
  选 This Computer + 文件夹
  POST /v1/runs { source:"desk", start:"inline", target:{ loop:"desk", tools:"desk", deskId } }
  → 响应带 assignment
  IPC desk:startRun
  订 GET /v1/runs/:id/events（和云对话一样）

主进程（host.ts）
  工作区 = 你选的那个文件夹（就地，不再 git worktree add）
  写 userData/neo-desk/runs/<runId>/run-bootstrap.json
  fork packages/worker（剥掉 Provider Key，带 NEO_SANDBOX_ROOT）
  POST /v1/desks/:id/claim { workspaceDir, pid }
```

**为什么就地改：** 旁路 worktree 从 HEAD 长出来，Agent 读不到你正在改的未提交文件，它的改动也落在你不会打开的副本里。Cursor 的 This Computer 就是改你点开的那个 checkout。

### B Remote control

对标 Cursor 的 **My Machines**（[docs](https://cursor.com/docs/cloud-agent/my-machines)）。控制面打不进 NAT 后面的笔记本，所以派活走 Desk 自己开的连接。

```text
Desk 主进程        GET /v1/desks/:id/inbox（SSE，出向长连接）
Web / handoff  →   POST /v1/runs（缺省 dispatch）
控制面             严格匹配 user + 机器在线且允许远程 + 仓库对得上
控制面         →   inbox 推 assignment
Desk 主进程        用已绑定的工作区 spawn，然后 claim
```

抄了：出向长连接、长驻、机器命名、**注册绑定到仓库**、严格匹配、失败不回落、绑定即预授权。

**没抄** 它的云端 loop + 本机工具 RPC：[`assertColocatedTarget`](../packages/contracts/src/run.ts) 明确 P0–P2 只允许 `loop === tools`，[architecture.md §2](./architecture.md) 也写了不要把每个 `read` / `edit` / `bash` 做成跨网 RPC。B 只做派单，loop 仍在本机。流式和跟进不受影响：worker 本来就是出向推事件、主动拉 inbox。

匹配失败一律**明确报错**，不回落云端、不留一条永远排队的 Run：

| 情况 | 文案 |
| --- | --- |
| 没握着 inbox | 这台电脑没打开 Desk |
| 关了远程开关 | 这台电脑关闭了远程派活 |
| 一个文件夹都没绑 | 这台电脑还没有绑定本机工作区 |
| 绑的是别的仓库 | 这台电脑绑的是别的仓库 |

## 客户端约束（已经写进代码）

- **工作区 = 授权目录本身。** 有 `.git` 才有 commit / PR；没有 git 的文件夹仍可读写、开终端。
- **沙箱：** pi 的 `read` / `write` / `edit` / `ls` / `grep` / `find` 逃出根就拒绝；`bash` 的重定向和 `rm`/`mv`/`cp` 一类写操作也拦。系统临时目录仍可写，否则构建工具会挂。只对本机 Run 生效（`NEO_SANDBOX_ROOT`）；云端 VM 本身就是隔离盒子。
- **Run 私货不进仓库：** session / bootstrap / jwt 在 `userData/neo-desk/runs/<runId>/`。专家文件仍写 `<workspace>/.neo`，但会加进 `.git/info/exclude`。
- **绝对路径不上云。** 绑定只上报机器名 + repoKey + 短名；远程端看到 `机器名 · 仓库名`。也不把本机路径同步成别人的项目默认仓库。
- **`online` = 正握着 inbox。** 只看时间戳会让一台注册完就退出的电脑看起来还在。
- **控制面不杀笔记本进程。** `DeskRuntime.destroy` 是空的；停 worker 走 inbox 的 `cancel`，活着靠 worker 心跳。
- 一期同一 Desk 只跑一条本机对话，避免两个 Agent 抢改同一份盘。
- 一期不允许 Automation 派到本机。
- 本机 Run **没有**「邀请加入这条对话」。一起干活要开 Cloud，或各开各的云端 Run。
- 切到云端 handoff 需要可 clone 的远端，未提交改动不跟随；切回本机要求该仓库已有绑定。
- 会话列表、transcript、跟进队列仍以控制面为准；关窗口不等于删对话。

渲染进程看不到 Node、看不到磁盘，只通过 `window.neoDesk` 选目录、读工作区文件、开终端。

```bash
pnpm dev:web        # Web UI :5173，API :8080
pnpm dev:desk       # Desk UI :5174 + Electron → 本地 :8080
pnpm dev:desk:prod  # 同一套 Desk UI → 线上控制面
pnpm pack:desk      # 打 mac / Windows / Linux zip，默认连 http://62.234.211.200
```
