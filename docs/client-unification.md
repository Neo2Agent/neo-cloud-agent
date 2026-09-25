# 三端统一：Web / Desk / Mobile 对齐 Cursor

本文回答三件事：Cursor 的客户端和 agent loop 是怎么摆的；Neo 的 Web、Desk、Mobile 现在哪里对齐、哪里没对齐；按什么顺序补。执行模型（loop / 工具 / 推理放在哪）以 [server-side-agent-loop.md](./server-side-agent-loop.md) 为准，本文不改。现状总图见 [architecture-overview.md](./architecture-overview.md)。

---

## 1. Cursor 怎么做

只写官方文档里有的。来源：[Cloud Agents](https://cursor.com/docs/cloud-agent)、[Cursor for iOS](https://cursor.com/docs/cloud-agent/web-and-mobile)、[Self-Hosted Machines](https://cursor.com/docs/cloud-agent/self-hosted)、[Agents Window](https://cursor.com/docs/agent/agents-window)、[Agent overview](https://cursor.com/docs/agent/overview)、[Reviewing code](https://cursor.com/docs/agent/review)、[Capabilities](https://cursor.com/docs/cloud-agent/capabilities)。

### 1.1 loop 放在哪

| 模式 | loop | 工具 | 客户端 |
| --- | --- | --- | --- |
| 桌面本地 agent | 桌面进程 | 本机 | Agents Window / IDE |
| Cloud Agent | Cursor 云（文档说 loop 在 Temporal，不在 VM 上） | 托管 VM | 桌面、cursor.com/agents、iOS、Slack、GitHub、Linear、API |
| Remote Control | 云端 | 本机（`/remote-control` 之后） | 手机 / Web 继续指挥本机那条会话 |
| Self-Hosted Machines | 云端（loop、推理、规划） | 你的 worker，出向长连接，不开入站端口 | 同 Cloud Agent |

所以「Web / 手机是纯云端壳」成立；桌面不是。桌面默认 loop 在本机，Remote Control 才把 loop 搬上云、工具留在本机。

### 1.2 三类客户端各做什么

| | cursor.com/agents（Web） | iOS | Agents Window（桌面） |
| --- | --- | --- | --- |
| 定位 | 发任务、看直播、跟进、审 PR、管环境和密钥 | 指挥和审查，不是 IDE | 多工作区、并行 agent、本地和云端来回切 |
| 直播 | 跟进运行中的 agent；点子代理卡片看子 transcript | 同左；缓存优先，先读本地再同步 | 同左 |
| 跟进 | 运行中 Enter 排队，Cmd+Enter 立即插话（steer，落在下一次工具调用） | 同左 | 同左 |
| 改动 | Git 面板：PR 头 + Diff / Review / Commits | 完整 diff、提交、checks、审批；可合并、改 reviewer | 新 diff 视图：审、提交、管理 PR；worktree |
| 其他 | Subscriptions（agent 在等的 CI / PR 评论 / 定时器） | Live Activities、每轮推送、语音、图片标注 | Cmd+K 会话搜索、side chat、`/goal` |
| 留给 Web 的 | —— | 编辑器、终端、文件浏览、环境和密钥、MCP 管理、账单 | —— |

所有端共用一个后端。Run 用 `source` 标来源（iOS 是 `iosApp`）。

---

## 2. Neo 已经对齐的

| Cursor | Neo |
| --- | --- |
| 客户端只打 API + 订直播 | Web / Desk / Mobile / CLI 只打 `/v1` + SSE；事件只生产一次，晚到的端先拉快照再接直播 |
| 桌面本地 / Cloud / Remote Control | Desk This Computer（本机 pi）/ Cloud / Remote Control（`neo-loop` + 本机工具，出向 WSS） |
| 推理不在客户端 | 只在 Gateway；客户端只拿 session / run JWT |
| `source` 标来源 | `web / desk / ios / android / cli / automation / …` |
| 订阅 CI / PR 评论 | `neo_subscribe`、GitHub webhook、CI autofix |

执行模型这一层不用再改。

---

## 3. 三端能力矩阵（2026-09-23，本次改完后）

✓ 有；△ 有但和其他端不一样；✗ 没有。括号里是本次改动前的状态。

| 能力 | Web | Desk | Mobile |
| --- | --- | --- | --- |
| 云端对话、直播、跟进、停止 | ✓ | ✓ | ✓ |
| Markdown 渲染 | ✓ | ✓（✗ 纯文本） | ✓ 实验室（✗）/ 原生仍纯文本 |
| 工作折叠（工具按类归组、进行中转圈） | ✓ | ✓（✗ 平铺工具卡） | ✗ 平铺工具卡 |
| 进行中不显示时间，结束后显示时间和耗时 | ✓ | ✓（△ 相对时间） | ✓（✗ 不显示） |
| 「正在思考」判定 | 共享 `shouldShowThinking` | 共享（原来工具之间会再冒出来） | 共享 |
| 输入法组词回车不发送 | ✓ | ✓（✗） | ✓ 实验室 |
| 运行中排队 / 插话 | ✓ Enter 排队、Cmd/Ctrl+Enter 插话（△ Ctrl+Enter 排队） | ✓（△ 只能排队） | ✓ 箭头排队，实验室 Cmd/Ctrl+Enter 插话（✗ 发送键变停止键） |
| 共享对话里的发送人 | ✓（✗ 不显示） | ✓（✗ 首条算成自己） | ✓（✗ 全用自己的头像） |
| 运行列表后台刷新 | ✓ 8s + 聚焦（△ 只在打开对话时） | ✓ 8s + 聚焦（△ 只在聚焦时） | ✓ 8s + 可见（✗ 从不） |
| 执行模式标签 | Remote / 本机（✗ 无） | 云端 / Remote / 本机（△ 英文小写） | 云端 / Remote（△ 英文小写） |
| Agent / Ask 模式 | 已删除 | 已删除（△ 前缀代码还在） | 已删除（△ `askPrompt` 还在） |
| Diff / 提交 / PR | ✓ Git 面板（头栏 ready / squash merge、点选文件、行号、审查页 CI） | △ 只有 `+N -M` | ✗ |
| 文件 / 终端 / 产物 | ✓ | ✓（本机 + 云端） | △ 只有产物 |
| 会话搜索 | △ 只有手机布局有 | ✓ 搜索面板 | ✗ |
| 推送 | ✗ | 系统通知（派活） | ✓ Expo 推送 |
| 视觉 | 冷灰单色、Geist | 暖纸木纹、Nunito | Island 纸卡片 |

### 3.1 原来写了三份的逻辑，现在在哪

| 逻辑 | 现在 | 原来 |
| --- | --- | --- |
| SSE 解析、增量合并、回合信号 | `contracts/client-stream`（`parseSseData`、`applyLiveEvents`、`batchTurnSignal`、`runEventsQuery`） | `web/src/stream-apply.ts`、`desk/src/stream.ts`、`mobile/src/stream.ts` |
| 正在思考、活动文案、消息时间、发送人 | `contracts/turn-view`（`shouldShowThinking`、`activityLabel`、`messageTimeLabel`、`userMessageAuthor`） | `web/src/turn.ts`、`desk/src/stream.ts`、`mobile/src/turn.ts` 各一份，语义不同 |
| 工具视图、工作折叠 | `contracts/work-view`（`partitionTurn`、`workGroupLabel`、`fileCardPreview` …） | 只有 `web/src/format.ts` |
| 回车语义、输入法 | `contracts/composer-keys`（`isImeComposing`、`composerKeyAction`、`followUpDelivery`） | `web/src/viewport.ts`；Desk 手写；Mobile 无 |
| 执行模式叫法 | `contracts/run`（`runMode`、`RUN_MODE_LABELS`、`RUN_MODE_SHORT_LABELS`） | 三端各写各的 |
| 运行列表刷新和排序 | `contracts/client-stream`（`RUN_LIST_REFRESH_MS`、`runsNewestFirst`） | 无 |
| Markdown | `packages/ui` 的 `MarkdownBody` + `ui/markdown.css` | 只有 `web/src/markdown.tsx` |

---

## 4. 问题清单

### 4.1 读代码发现的

1. **Remote Control 在现网跑不起来。** Remote 要 `neo-loop`，而 `deploy.sh` 每次都会把现网 `neo-loop` 关掉（4C/4G 内存的取舍），但 Desk 上仍然能选 Remote。**未改**，放第二期：`/health` 报 `neoLoop.available=false` 时把 Remote 置灰，或加内存后开 loop。
2. **手机浏览器打开 Web 布局是坏的。** 桌面的「折叠侧栏 = 48px 图标栏」在窄屏也生效，关掉的侧栏被排到第 2 行；窄屏检查器覆盖层的层级低于输入框；对话列表按钮随图标栏一起进了侧栏，关掉后没地方打开。**已修**，见 §6.3。
3. **Web 普通对话也显示 Diff 和「开草稿 PR」。** 在 Git 面板那个 PR 里修（按 `runGitContext` 显示）。人入口已去掉：绑仓库的对话进 IDLE 且分支有提交时，控制面 handoff 自动开草稿 PR。
4. **Desk 回车没有输入法保护。** **已修**。
5. 原先怀疑 `applyLiveEvents` 合并 `message.delta` 时丢 id 会导致重连重复。核对后不成立：三端都在合并前按 id 去重，而且每批都从空数组开始合并。断流重连实测（§6.1 S7b）也没有重复。

### 4.2 多端实测发现的

三组实测：云端 Run 四端同步（两个 Web 标签、Mobile 实验室、Desk）、Desk 三态、多账号协作。完整报告和截图附在 PR 里。

| # | 问题 | 严重度 | 状态 |
| --- | --- | --- | --- |
| P1 | 停止后迟到的 `agent.end`（或回合结束时服务端已是 IDLE）让 Web / Desk 一直显示「工作中」和停止键，要刷新才恢复；手机正常 | 高 | 已修：控制面在 IDLE 时收到 `agent.end` 补发 `run.idle` |
| P2 | 审批制邀请链接：同一个人再点一次「加入」就绕过审批直接入组；别人拿着已申请 / 已用过的链接也能进 | 高（安全） | 已修：`acceptInvite` 对 pending / accepted 分别处理；Web 邀请页申请后按钮禁用 |
| P3 | 协作者（editor）能改名、归档、删除房主的对话 | 高（安全） | 已修：这三个接口要房主或项目管理员；协作者仍可停止 |
| P4 | 新对话、转交、改名不会出现在其他端列表里（Web 首页、Mobile 从不刷新，Desk 只在窗口聚焦时刷新） | 高 | 已修：三端后台 8s 刷新 + 聚焦刷新；Mobile 列表按最近活动排序 |
| P5 | 共享对话里看不出谁发的：首条 `user.message` 没带发送人；Web 不显示；Desk 把别人的首条算成自己；Mobile 全用自己的头像 | 中 | 已修：首条带 `actorUserId/actorEmail`；三端用 `userMessageAuthor` 标注 |
| P6 | 转交给不是协作者的人时，新房主的 email 被存成 userId | 中 | 已修：从项目成员里取 email |
| P7 | 深链打不开的对话（本机对话、没权限、已删）：Web 停在一个能打字但一定失败的输入框，发送后显示原文 `not_found`；Mobile 静默回首页 | 中 | 已修：两端都提示原因并回首页 |
| P8 | Web 顶栏显示的是首句 prompt，不是标题，别处改名不更新；Desk 顶栏同样不更新；Mobile 对话页不显示标题 | 中 | 已修 |
| P9 | Web 侧栏悬停时隐藏的时间盖住归档按钮，点击变成打开对话 | 中 | 已修：隐藏时 `pointer-events: none` |
| P10 | Desk 在答复出完、`agent.end` 之前会闪一下「正在思考…」；Desk 进行中的消息显示时间 | 低 | 已修：共享 `shouldShowThinking` 和 `messageTimeLabel` |
| P11 | 执行模式叫法三端不一（云端 / cloud、Remote Control / remote），Web 列表没有标签，Desk 的 Cloud 对话顶栏没有标识，Remote 空闲时也显示绿色「运行中」 | 低 | 已修：共享 `RUN_MODE_*`；Remote 显示「本机工具已连接」 |
| P12 | 别处归档当前打开的对话后，Desk 输入框没锁 | 低 | 已修 |
| P13 | Web 邀请页文案说加入后能看到「对话」，实际只能看到被邀请进的对话；申请后跳到空项目页，没有「等待通过」提示；项目详情页不刷新成员 / 待审批 | 低 | 已修 |
| P14 | 转交后原房主降为协作者，对话仍在原房主列表里 | 设计 | 未改：现在的语义是「交出主导权、保留协作」。要改成「移交」再讨论 |
| P15 | Web 没有「邀请协作者进对话」入口，只有 Desk 有 | 缺功能 | 未改，放第二期 |
| P16 | Desk 自己离线（inbox 断开）时，Desk 界面上没有提示；Web / Mobile 3~4 秒内正确锁住并提示 | 低 | 未改，放第二期 |
| P17 | Remote Control 的 transcript 显示「正在这台电脑上启动 Agent」，在 Web 上「这台电脑」指代不清 | 低 | 未改，放第二期 |
| P18 | 产物在 Web 是可点的文件卡片，在 Desk 和 Mobile 是一行文字（Mobile 还多一条「已上传 notes.md」气泡） | 低 | 未改，放第二期 |
| P19 | 对话删除后，收件箱里指向它的通知还在，点进去打不开 | 低 | 未改，放第二期 |

---

## 5. 分期方案

### 第一期（本次，两个 PR）

1. **同步修复**：§4.2 的 P1–P13。
2. **Web 手机布局**：§4.1 第 2 条。
3. **共享客户端核心**：§3.1 的模块放进 `packages/contracts` 子路径，`MarkdownBody` 移到 `packages/ui`，三端的旧文件删掉或改成转出，单测跟着搬到 contracts。
4. **运行中的发送语义统一成 Cursor 那套**：空闲时 Enter 发送；运行中 Enter 排队（`delivery: "follow_up"`），Cmd/Ctrl+Enter 立即插话（`delivery: "steer"`）；组词中不处理；手机上回车换行，箭头按钮在运行中排队。
5. **Desk 补齐**：输入法保护、Markdown、工作折叠和转圈、进行中不显示时间、删掉 Ask 残留。
6. **Mobile 补齐**：消息时间、运行中排队（实验室和原生）、实验室 Markdown、统一「正在思考」、删掉 `askPrompt`。
7. **Web Git 面板**（单独的 PR）：普通对话不显示 Git；绑了仓库或本机目录的对话显示 PR 头 + Diff / 审查 / 提交记录；本机工作区由 Desk 回传快照。展示对齐 cursor.com/agents 右栏：头栏状态机、选中文件 + 双 gutter、工作区 dirty 才出提交底栏、审查页分组 CI，失败时才出查找问题。

### 5.1 Cursor 的两套 Git 皮（2026-09-24 补）

官方文档里 Git 有两套界面，Neo Web 对齐的是第一套（cursor.com/agents 右栏，不是桌面 Agents Window）：

- **cursor.com/agents（Web / iOS）**：右栏 Git。同一套头栏：截断标题（多 PR 时是 `1 of N` 下拉）/ `查看 PR` 跳选中的仓库；`head → base` 跳 compare；主按钮按 GitHub 状态切换（文案跟 Neo 其他面板一样用中文，控件用文件栏那套 24px / 6px 圆角）。可合并时主按钮是分体：默认压缩合并，右侧 ▾ 可选合并 / 变基合并。人**不**点「开草稿 PR」：云端轮次 `agent.end` → IDLE 后，控制面 `maybeDeliverHandoffDraft` 在分支有提交且已配 GitHub 时 push 并开 draft（已有 GitHub PR 则只 push）。`neo_pr_open` / `POST /v1/runs/:id/pull-request` / `pnpm neo pr` 仍留给 agent 和运维。
  - 无 PR（cloud）：头栏只有「还没有 PR」，没有主按钮
  - `N = 1`：截断标题，不出 `1 of 1`
  - `N > 1`：`标题  1 of N` 下拉。列表 = 本 run 已挂的 PR + refresh 时沿 `base` 补的父 PR（不扫 sibling）。点色：打开绿 / 草稿灰 / 已合并紫。有 `additions`/`deletions` 才显示 +/-。切换跟 `查看 PR`、ready/merge、审查 CI；改动 / 提交仍是工作区
  - `draft`：`标为可合并` → `POST /v1/runs/:id/pull-requests/:n/ready`（GitHub `PATCH` `{ draft: false }`）
  - `open` 且未合并：`压缩合并` → `POST /v1/runs/:id/pull-requests/:n/merge`（`{ merge_method: "squash"|"merge"|"rebase" }`，默认 squash）
  - `merged` / `closed`：禁用，文案 `已合并` / `已关闭`
  - `local://`、Desk、未配 SCM：写按钮不出现；handoff 也不造 `local://` 假 PR。失败时头栏显示 GitHub 原文，`查看 PR` 仍可打开仓库
- **改动**：选中文件 + 双 gutter；连续未改行可折成「N 行未改」。提交底栏只在 `GET /diff` 的 `dirty`（工作区相对 HEAD）为真时出现。有 GitHub PR 且工作区干净时，改动页只审 PR。
- **审查**：CI 手风琴按 `进行中` / `失败` / `已通过` 分组，左侧图标。有失败或进行中默认展开，全绿默认收起。**只有 `failed > 0`** 时在手风琴底部出「查找问题」（`POST /v1/runs/:id/review`）。审查页签：进行中转圈、失败红点、全绿绿点。不做 Ready to merge 第二颗合并按钮。内部页签用和文件栏一样的灰底 pill。
- **Cursor 3 Agents Window**：改动树、Commit and Push 下拉。这是桌面编排面，Neo 不跟。

Neo 现在的 Web 面板：`runGitContext` 门控、merge-base 按文件 diff、`dirty`、`GET /commits`、审查页 CI、Desk 快照、ready / squash merge。Desk / Mobile 自己的 Git 标签仍是第二期。改 reviewer、行内评论回写仍是第三期。

### 5.2 协作组文件夹 + 组内选仓（2026-09-24）

项目是侧栏一个可折叠协作组文件夹（人、指令、资产），不是 Cursor 的「项目 ≈ 一个仓」。组内新对话只开云端。拉人进同一条云端项目对话是唯一可选分享；不拉人就是个人正常对话。不做转交房主，也不做 ownership router。

| 层 | Neo |
| --- | --- |
| 协作组 | `Project` + 成员 / 指令 / 邀请。侧栏最上置顶，然后 **项目 / 仓库 / 日常**：有 `projectId` 进项目夹；没项目但绑了仓按仓折；两样都没有进日常。不按仓自动建 Project。视觉对齐 Cursor：弱段头、夹上 chevron、组内种类挂在夹上（代码 / 办公），对话行只留标题 |
| GitHub 账号 | 设置里 OAuth 绑定当前用户自己的 GitHub。`GET /v1/integrations/github`；token 按 `userId` 存，不是整机 PAT |
| 组内选仓 | Composer 一个仓库 pill：关着显示「无仓库」或 `owner/repo`；打开后搜索账号仓库（`GET /v1/scm/repos?q=`）。未绑则去设置。发出后只读。Web 不再预填项目 `defaultRepoUrls` |
| 无仓不被回填 | `CreateRunRequest.skipRepoDefaults`。显式无仓时服务端不得用项目或环境默认仓填 `repoUrls` |
| Git / PR | 只在绑仓对话（`runGitContext !== none`）：clone、Git 页签、审查 CI、失败才「查找问题」、idle 开草稿 PR。该用户的 clone / push 优先用自己的 OAuth token。无仓仍有终端 + 文件 |
| 拉人 | 仅云端 + `projectId`。全局闲聊、没进项目的绑仓闲聊、本机对话都不能拉人 |
| Web 配置 | 项目配置不再编默认仓库。Settings `#repo` 只给预热用，不再驱动新对话 |

对齐（只在绑仓对话）：cursor.com/agents 的 Git 页签行为。侧栏仓库段对齐「按仓归组」；项目段仍是协作组。不对齐 / 不做：Origin 草稿仓、桌面 This Computer / Select Multiple、按仓自动建 Project、项目必须等于一个仓、转交房主、GitHub 登录 Neo。

### 第二期

- 视觉 token 统一到 `packages/ui`，以 Web 现在的单色风为基准；Desk、Mobile 换皮。
- Desk 和 Mobile 的输入框改成 Cursor 式：选择器在框外上方，框内是 `+`、模型、用量、麦克风、圆形发送 / 停止。
- Git 面板复用到 Desk（本机 git）和 Mobile（只读 PR / 提交）。
- Web 桌面加 Cmd+K 会话搜索；Web 加「邀请协作者进对话」（P15）。
- 运行列表改成推送：用户级 SSE 推「列表变了」，替掉 8s 轮询。
- `/health` 报告 `neo-loop` 可用性，现网不可用时 Desk 把 Remote Control 置灰（§4.1 第 1 条）；P16、P17。
- Mobile 原生：Markdown、工作折叠、插话。

### 第三期

- 手机缓存优先、每轮推送、Live Activity 类的锁屏进度。
- 子代理子 transcript 视图。
- 本地和云端互相转交（Cursor 的 Move to Cloud / 回到本地）、worktree。
- 改 reviewer、审查意见回写 GitHub 行内评论。

---

## 6. 多端实测记录

环境：本地 control-plane（mock LLM，`RATE_LIMIT=0`，`WORKER_RUNTIME=local`），Web `:5173`，Mobile 实验室 `:5175`，两个 Desk 窗口（`pnpm dev:desk:two`，`NEO_DESK_CDP_PORT` 开 DevTools 端口给 Playwright）。测 Remote Control 时起了 `pnpm dev:loop`。mock 上游不出工具调用，工具回合用 run JWT 调 `POST /internal/runs/:id/events` 注入。

### 6.1 修之前

| 场景 | 结果 |
| --- | --- |
| 云端回合直播（文字、工具、状态、停止键） | 四端 0.7s 内一致 |
| 另一端跟进 / 停止 | 四端 0.5s 内一致 |
| 断流 7 秒后恢复、晚进来的端先拉快照再接直播 | 一致，无重复、无丢失 |
| 停止后迟到的事件 | Web 和 Desk 一直「工作中」+ 停止键（P1） |
| 新对话、改名、转交进列表 | Web 首页、Mobile 从不；Desk 只在聚焦时（P4） |
| This Computer 对 Web / 手机不可见 | 符合设计；深链体验差（P7） |
| Remote Control：Web / 手机跟进；Desk 离线锁 | 跟进 0.7s 同步；离线 3~4 秒锁住，服务端 409 |
| 邀请审批、协作者权限、署名、转交 | P2、P3、P5、P6 |

### 6.2 修之后（同一套场景复跑）

| 场景 | 结果 |
| --- | --- |
| 停止后迟到的 `tool.end` / `message.*` / `agent.end` | Web、Desk 停止后 1.5s 内结束，9 秒后仍是「工作了 4s」，无停止键 |
| 三端同一回合：手机点箭头排队，Web 按 Ctrl+Enter 插话 | 请求体分别是 `follow_up` 和 `steer`，服务端按原样记录；三端结束后一致（「工作了 5s」、无停止键） |
| 新建对话进其他端列表 | Web 首页 1.0s，Mobile 4.4s，Desk 4.7s |
| 改名进顶栏 | Web 2.5s，Mobile 2.8s，Desk 5.2s |
| 共享对话署名 | 房主看到协作者的消息标「mate」，协作者看到首条标「admin」 |
| 协作者改名 / 归档房主的对话 | 403 |
| Desk 输入法回车 | 组词中回车 0 次请求，组词结束后回车创建对话 |

### 6.3 Web 手机布局

390 / 768 / 860 三个宽度：关掉的侧栏 `position: fixed` 移到屏幕外，对话区占满整屏（原来只有上面 45%）；顶栏有「打开对话列表」按钮，抽屉整屏打开；检查器覆盖输入框，右上角「返回对话」。`static.test.ts` 断言窄屏关闭态侧栏是 fixed、检查器层级高于输入框；`e2e/core/ui/narrow.spec.ts` 在 390 和 860 下验证侧栏不占位、检查器打开时输入框不在最上层。
