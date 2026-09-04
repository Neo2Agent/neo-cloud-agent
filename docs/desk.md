# Neo Desk

独立 Electron 客户端。和 Web **共用控制面 / gateway / worker**，UI 在 `packages/desk/ui`，**不复用** `packages/web` 那套浅色壳。

对标 Cursor **Agents Window**（This Computer / Cloud / Remote），不是对话页的 Diff / 终端 / 产物三标签。

项目协同的对象和阶段见 [desk-project-design.md](./desk-project-design.md)。This Computer 工作区一期见 [desk-this-computer.md](./desk-this-computer.md)。总图见 [architecture-overview.md](./architecture-overview.md)。

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

`Cmd+W` 关当前会话。本机目标在 composer 上选 **This Computer** 或 **Remote Control**，并先授权一个文件夹。Cloud 走云端。Remote SSH 占位已经删掉。网页新开一条派到这台电脑是二期，不是 composer 上的第三项。

## 右侧栏

右上角按钮开合。刚打开时先出 Terminal / File 两个入口；点进去才是终端或文件树。中间永远是对话，**不是** Web 那种「切到终端页就把对话切走」。

| tab | 本机 | 云端 |
| --- | --- | --- |
| Files | 可展开的文件树 + 只读预览，锁在授权根 | `GET /v1/runs/:id/fs`，只读 |
| Terminal | 浅色工作区 + 右侧会话列表，可新开多个 | 命令输出 + setup 日志，标题写「输出」，**不能打字** |

**不做 IDE。** Files 只有树 + 只读预览，没有栏内编辑保存。要改文件：让 Agent 改，或自己在编辑器里改，Files 刷新即可。

两点如实说明：

- 本机终端是**管道 shell，不是 pty**。真终端设备要 native 模块，而本仓库 `onlyBuiltDependencies` 只放行 esbuild。在黑色区域里直接输入（中文输入法走隐藏输入框）；需要 tty 的全屏 TUI 不行。`createLocalShell` 是留好的接缝。
- 云端交互式 PTY 没做（要另开一条打进 VM 的通道）。

## 已落地的执行面

| 期 | 内容 |
| --- | --- |
| P0 | `KillMode=process`；worker 增量备份 session；`detachOrQueue`；独立 Electron + Desk UI |
| P1 | Agents Window 壳：侧栏对话/空间、composer 上的 Cloud / This Computer / 模型、`Cmd+W` |
| P2 | `/v1/desks` 登记；inline 本地起 + dispatch 远程派；`DeskRuntime`；`POST /v1/runs` 的 `target`；双向 handoff（干净 clone，未提交改动不跟随）；右侧栏 Files / Terminal |

未做（刻意）：隔离 worktree、P3 并排窗格 / SSH 远程机、云 loop + 本机工具 RPC、云端交互 PTY、栏内编辑器。

## This Computer 和 Remote control 是两个东西

一期口径见 [desk-this-computer.md](./desk-this-computer.md)。登记一台机器不等于同意被派活，也不等于上报文件夹。

| | This Computer | Remote Control（同一套本机执行） | 二期：网页新开派活 |
| --- | --- | --- | --- |
| 谁能发起 | 只有你，在这台 Desk 前面 | 这台 Desk 开场 | 网页新开一条派到这台电脑 |
| 控制面知道什么 | `deskId` + 本机路径 | 同上 + `remoteControl: true` | 再加机器名 + 仓库名（**不含绝对路径**） |
| 网页 | 看不见、不能跟进 | 看得见；Desk 在线可跟进同一条 | 「目标 → 本机」可选到具体工作区 |
| 工作区记在哪 | **这条 run**，不进 desk 清单 | 同左 | `desk.allowRemote` 打开后报到 `desk.workspaces` |

`dws_local_*` 只留在 Desk 本机。两种本机开场都不传 `deskWorkspaceId`。`bindWorkspace` 只写本机记录。可见性按对话上的 `remoteControl`，不在设置里开整机开关。文件夹仍在 composer 上选。

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

**为什么就地改：** 旁路 worktree 从 HEAD 长出来，Agent 读不到你正在改的未提交文件，它的改动也落在你不会打开的副本里。Cursor 也是这样：worktree 是**显式 opt-in**（Agents Window 里选、IDE 里 `/worktree`、CLI 里 `-w`），默认所有会话共享同一个 checkout——"every agent and chat session you open on the same folder shares one Git checkout"，见 [worktrees](https://cursor.com/docs/configuration/worktrees)。它也没有回避共享的代价，subagents 文档原话是 "Subagents share the parent agent's checkout by default. When several subagents edit files at once, they can overwrite each other's changes."（[subagents](https://cursor.com/docs/subagents)）。所以我们同文件夹开第二条给提示而不拦，和它一致。

**并发上限只是我们自己的资源约束。** Cursor 没有公布任何本地并发上限，口径是"想跑多少跑多少"（[cloud agents](https://cursor.com/docs/cloud-agent)）；它唯一的机器级数字是 worktree 保留上限 `cursor.worktreeMaxCount` 默认 25，那是磁盘清理阈值，不是会话上限。我们默认 4 的理由只有一个：每条本机对话是一个独立 Node 进程。

**和 Cursor 的一处结构性差异：** 它的纯 This Computer 会话"lives entirely inside your desktop app, with no cloud-side representation"，而我们的本机 run 始终在控制面有一条记录（不变量 3：会话权威在控制面）。好处是 worker 逐回合退出后还能恢复、跟进能重新派回同一台机器；代价是本机执行会依赖控制面，所以准入必须显式跟控制面解耦——见下面的客户端约束。

### worker 逐回合，不常驻

本机 worker **一回合跑完就退**（`WORKER_EXIT_AFTER_TURN=1`，`spawnDeskWorker` 里写死，不给开关——曾经有个 `exitAfterTurn` 参数从没人传，却让这个不变量看起来可配）。`session.prompt` 是 await 的，所以 inbox 再拉一次为空就说明这轮结束、后面也没排队，此时上传 session 备份并退出。

进程寿命比对话回合长会带来三种真故障，都不值得为了省一次冷启去承担：

| 常驻的代价 | 结果 |
| --- | --- |
| run JWT 一小时过期 | worker 死在 `inbox 401`，而 assignment 又发缓存里同一个死 token，这条对话再也起不来 |
| 占着并发名额 | 已结束的 worker 仍算在上限里，新的本机对话被白白挡掉 |
| 进程活着但 run 已 IDLE | 界面分不清，进度条一直挂着 |

退出后 Desk 调 `POST /v1/desks/:id/release`，控制面丢掉 handle。下一条跟进走 `resumeRun` → `dispatchToDesk`，**同一台机器**收到新的 assignment，新进程 `downloadSession` 恢复上下文再跑。

常驻的只有 **Desk 主进程的 inbox / lease 长连接**——remote control 必须靠它，否则控制面找不到这台笔记本。云端 run 不受影响：`WORKER_EXIT_AFTER_TURN` 只有 Desk 会设。

### B Remote control

对标 Cursor 的 **My Machines**（[docs](https://cursor.com/docs/cloud-agent/my-machines)）。控制面打不进 NAT 后面的笔记本，所以派活走 Desk 自己开的连接。

```text
Desk 主进程        GET /v1/desks/:id/inbox（SSE，出向长连接）
Web / handoff  →   POST /v1/runs（缺省 dispatch）
控制面             严格匹配 user + 机器在线且允许远程 + 仓库对得上
控制面         →   inbox 推 assignment
Desk 主进程        用已绑定的工作区 spawn，然后 claim
Desk 主进程    →   POST /v1/desks/:id/release（worker 跑完退出）
Web 再发一条   →   控制面重新派单，同一台机器起新进程
```

Web 端在 composer 的「目标 → 本机」里选 `机器名 · 仓库名`，选的是**已绑定的工作区**，不是路径。浏览器里没有绑定就没有可选项。

抄了：出向长连接、长驻、机器命名、**注册绑定到仓库**、严格匹配、失败不回落、绑定即预授权。

**没抄** 它的云端 loop + 本机工具 RPC：[`assertColocatedTarget`](../packages/contracts/src/run.ts) 明确 P0–P2 只允许 `loop === tools`，[architecture.md §2](./architecture.md) 也写了不要把每个 `read` / `edit` / `bash` 做成跨网 RPC。B 只做派单，loop 仍在本机。流式和跟进不受影响：worker 本来就是出向推事件、主动拉 inbox。

二期若要拆开这两轴，先读 [desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md)：那里核过 Cursor 的实际形态、pi 自带的远程工具接缝，以及沙箱必须先从 worker 搬到 Desk 侧这件事。

匹配失败一律**明确报错**，不回落云端、不留一条永远排队的 Run：

| 情况 | 文案 |
| --- | --- |
| 没握着 inbox | 这台电脑没打开 Desk |
| 关了远程开关 | 这台电脑关闭了远程派活 |
| 一个文件夹都没绑 | 这台电脑还没有绑定本机工作区 |
| 绑的是别的仓库 | 这台电脑绑的是别的仓库 |

## 客户端约束（已经写进代码）

- **工作区 = 授权目录本身。** 有 `.git` 才有 commit / PR；没有 git 的文件夹仍可读写、开终端。
- **一份 `.neo`。** 仓库认什么、worker 读什么，和云端同一套 `createWorkspaceLoader`。不为 This Computer 另做 Cursor Customize，也不单独加载 `.cursor/rules`、`.cursor/commands`、`.cursorignore`。Cursor 兼容只保留云端已经有的（`environment.json` 回落、skills / agents / hooks 文件名）。
- **本机多的是墙和寻址。** 云端 VM 本身就是盒子；本机才有「用户选的文件夹」和真磁盘出界。`NEO_SANDBOX_ROOT` 只对本机 Run 生效：pi 的 `read` / `write` / `edit` / `ls` / `grep` / `find` 逃出根就拒绝（展开 `~` / `$HOME`，顺着符号链接看真实落点）；`bash` 的重定向（含 `1>` / `2>` / `&>` / `>|`）和 `rm`/`mv`/`cp` 一类写操作也拦。系统临时目录仍可写，否则构建工具会挂，但 `ln` 不准把工作区名字链到 `/tmp` 或家目录。出界默认 `deny`，不问人。`ask` / `allowlist` 若以后做，只进 Desk prefs + `NEO_SANDBOX_*`，云端 worker 不读。
- **选目录就是授权。** 家目录和磁盘根直接拒；`/tmp`、`/Users` 这类过宽目录要二次确认。确认框文案：只改这个文件夹；`.neo` 和云端同一套，不是另一产品。设置一期分栏是基础配置（并发上限）和模型配置，不加「加载 `.cursor`」开关；composer `/` 不接 Cursor commands。
- **`.neo/` 禁止 Agent 写**（执行墙，防并行串改）。同一文件夹两条对话的专家文件、贴图、boot 日志按 runId 写在 `<workspace>/.neo/runs/<runId>/`；读序是 scratch 优先，再回落 `<cwd>/.neo`。session / bootstrap / jwt 仍在 `userData/neo-desk/runs/<runId>/`。整个 `.neo/` 在 `.git/info/exclude` 里。`.git/hooks`、`.git/config`、`.git/info/attributes` 以及云端本来就读的 `.cursor/hooks.json` / `.cursor/hooks/` 同样只读——写进去会活过这一轮。不要再扩一份本机专用「Cursor 保护清单」当产品功能。
- **一期路径只挂在发起这条 run 的 Desk 侧。** 工作区记在 run 的 `repoUrls[0]`，不报到 desk 工作区清单。清单上报（机器名 + repoKey + 短名、不含绝对路径）是二期 Remote control。也不把本机路径同步成别人的项目默认仓库。
- **`online` = 正握着 inbox。** 只看时间戳会让一台注册完就退出的电脑看起来还在。
- **控制面不杀笔记本进程。** `DeskRuntime.destroy` 是空的；停 worker 走 inbox 的 `cancel`，活着靠 worker 心跳。
- **退出 Desk 会带走 worker。** 它们在改用户自己的文件夹，留一个孤儿进程等于让没人看着的仓库继续被改。`claim` 失败同样会把刚起的进程收掉。
- **本机对话可以并行，边界是资源不是文件夹。** 不同文件夹互不相干；同一个文件夹也允许开第二条，只是会提示未提交改动可能打架（理由见上面和 Cursor 的对比）。唯一的硬限制是「同时最多几条」，默认 4，设置里可调，理由是每条都是一个独立 Node 进程。macOS 和 Windows 上路径大小写不敏感，`/Users/me/Web` 和 `/Users/me/web` 是同一个 checkout，同文件夹判断要按平台归一化，否则那条提示会静默失效。
- **仓库对不上就明确报错，不降级。** 抄 Cursor 的保守默认：一条 run 指名了工作区，就必须拿到那一个，找不到就失败，绝不回落到「当前选中的文件夹」。它的 My Machines 也是这样——"a request for repo A should never run on a machine checkout for repo B"（[my machines](https://cursor.com/docs/cloud-agent/self-hosted-guides/my-machines)）。
- **准入只看本机事实，一次网络请求都不发。** 有几条在跑由主进程自己的 `localRuns` 表决定，占位在任何 `await` 之前就写进去。控制面只用来回收「run 已结束但进程还在」的 worker，而且**只有被上限拦住时**才去问（一次并发问完），问不到就不动它。现网抖一下不该让你在自己的盘上干不了活，也不该让开新对话多等几个 RTT。
- **判断 run 是否已结束要带上 `NOT_YET_STARTED`。** 每条 desk run 在这台机器 `claim` 落地之前都是这个状态（`createRun` 的 inline 分支和 `dispatchToDesk` 都走 `queueRun`）。漏掉它，spawn 到 claim 之间的 worker 在下一条对话看来就是「已经结束」，会被回收——开第二条对话把第一条杀掉。主进程复用 `src/stream.ts` 的 `isActiveRunStatus`，不留第二份会漂移的定义。
- **每条对话的文件夹由 run 自己说。** `localRunFolder(run)` 读 run 的 `repoUrls[0]`；文件树、diff、`resumeLocalRun` 都用它。回落到「当前选中的文件夹」在并行下必然指错——picker 是给空 composer 用的。同理 handoff 不给 `deskWorkspaceId` 也不能用 picker 的补，宁可不给（主进程会用调用方传的 folder）。
- **worker 起不来只发 `error`，不发 `exit`。** 所以 `error` 也要释放名额并报失败，否则那个槽位一直被占，攒够上限这台机器就再也开不了本机对话。
- **per-run 私货按 runId 寻址。** 专家文件、贴图、boot 日志都在 `<workspace>/.neo/runs/<runId>/`；`availableSubagents` / `readExpertWorkspace` 共用 `expertDocRoots` / `expertAgentDirs`，scratch 优先。云端 run 一个工作区只有一条，仍用 `<workspace>/.neo`。
- 打断这一轮只用输入框里的停止键；它会停掉本机这一轮的 worker。
- 一期不允许 Automation 派到本机。
- 本机 Run **没有**「邀请加入这条对话」。一起干活要开 Cloud，或各开各的云端 Run。
- **本机对话不能切到云端。** 活儿在你自己的文件夹里，通常还没提交，「搬到云端」只会把真正的改动留在原地。要在云端跑就另开一条云端对话。反向（云端 → 本机）仍然可以，且要求该仓库已在那台机器上绑定。
- **一个回合就是一个回复气泡。** 模型在一轮里可能多次在文字和工具之间来回，这些是同一条消息里的 blocks，不是多条「Neo 已完成」。pi 每个 LLM 回合都会 `agent_end`，那不是对话结束；worker 只在 `session.prompt` 返回后发一次 `agent.end`。
- **跟进是对话，不是排队条。** 当前这条没有未完成回合时，发出去立刻出用户气泡，下面跟 Web 一样的「正在思考…」。本机 FIFO（同一文件夹同时只跑一轮）仍在控制面执行，不再用「排队中 · 用户 · 正文」挡着。
- **自己在这扇窗口里发的，不弹系统通知。** 本机 worker 一回合一进程，跟进会再拉起进程；那是预期，不是「远程派活」。只有窗口不在前台、或 Remote control 派来的活，才用「本机开始一条对话」。
- 会话列表、transcript 仍以控制面为准；关窗口不等于删对话。

渲染进程看不到 Node、看不到磁盘，只通过 `window.neoDesk` 选目录、读工作区文件、开终端。

## 代码约定

按阿里巴巴开发手册里能落到 TypeScript 的那几条，Desk 这边的具体做法：

| 规约 | Desk 的做法 |
| --- | --- |
| 不允许魔法值 | 超时、重试间隔、并发上限、状态文件名、预览截断长度、过宽目录名单、出界策略、`.neo` / `agents` 相对路径都是命名常量（`LEASE_WAIT_MS`、`RELEASE_RETRY_DELAYS_MS`、`QUIT_GRACE_MS`、`SECRET_FILE_MODE`、`TARGET_STATE_FILE`、`OVERLY_BROAD_FOLDER_NAMES`、`DEFAULT_OUT_OF_WORKSPACE_POLICY`、`NEO_DIR`…），常量声明在用它的模块顶部，不做一个大而全的常量文件 |
| 命名 | 常量 `UPPER_SNAKE_CASE`，类型 `PascalCase`，函数与变量 `lowerCamelCase`，文件 `kebab-case`；不让函数和它读的字段同名（`localRunLimit()` 读 `prefs.maxLocalRuns`） |
| 单一职责、方法别太长 | `startAssignment` 拆成 `resolveRunFolder` / `reserveLocalSlot` / `prepareRunLaunch` / `watchLocalWorker`；run bar 的状态判断从 `App.tsx` 抽到 `ui/chat/local-run-view.ts`；`confirmFolder` / `isOverlyBroadFolder` 纯函数在 `workspace.ts` / `folder-auth.ts`，`host.ts` 只弹窗；`loadProjectSubagents` 与 `readExpertWorkspace` 共用 `expertDocRoots` / `expertAgentDirs` |
| 异常不能吞 | 空 `catch {}` 要么走 logger，要么写清此处为什么确实无事可报（例如首次启动时状态文件不存在；subagent 读不到某个 agent 目录就跳过并写清原因） |
| 日志要带现场信息 | `src/log.ts` 统一 `[desk:<scope>] message key=value`；字段而不是字符串拼接；`error()` 同时打印 message 和 stack。应用运行时不用裸 `console.*`（构建脚本除外）。本机出界策略不打到云端 worker 日志里 |
| 不重复定义 | run 活跃状态只有 `src/stream.ts` 那一份 `isActiveRunStatus`，主进程复用而不是自己再列一遍；专家根解析只有 `expert-roots.ts` 一处；出界策略归一化只有 `normalizeOutOfWorkspacePolicy` |
| 单测可重复、互不依赖 | 决策逻辑抽成纯函数再测：`admitLocalRun`、`localRunView`、`composerMaxWidth`、`formatLine`、`isOverlyBroadFolder`、`expertDocRoots` / `expertAgentDirs`、`normalizeOutOfWorkspacePolicy` |

```bash
pnpm dev:web        # Web UI :5173，API :8080
pnpm dev:desk       # Desk UI :5174 + Electron → 本地 :8080
pnpm dev:desk:prod  # 同一套 Desk UI → 线上控制面
pnpm pack:desk      # 打 mac / Windows / Linux zip，默认连 https://neorun.cloud
```
