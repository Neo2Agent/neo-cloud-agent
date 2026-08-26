# Desk 项目协同设计计划

> 版本：v1.1 / 2026-08-24  
> 范围：**Desk 端先做完**。Web 只复用同一套 `/v1` 合约，界面适配放到 Desk 设计冻结之后。  
> 对照：WorkBuddy 项目 / 任务 / 看板 / 资料库 / 留言板，以及现网 Desk 壳（`packages/desk/ui`）。  
> v1.1：锁定「只要云端项目对话才能拉人进同一条会话」；**不新开 BTRFS 服务器**。

本文是落地计划，不是调研摘抄。WorkBuddy 的产品调研见 [workbuddy-project-collaboration.md](./workbuddy-project-collaboration.md)。Desk 已落地的执行面见 [desk.md](./desk.md)。

---

## 0. 一句话

**项目是共享规范，Run 是一次干活。Desk 是项目的主工作台。**

一个人或一组成员进同一个项目，共用指令、成员、看板、资产。真正改代码、跑 Agent 的还是现在的 `Run`。

**完整项目协作（对齐 WB 实测）只发生在云端项目对话里：** 发起人邀请项目成员加入**这一条** Run。加入之后，两端读同一份 session / transcript，订同一条 SSE，用发起人的 workspace 和发起人那一个云端 Agent loop。两人同时发消息必须进 FIFO，同一时刻只有一条在跑。本机 This Computer 对话不能拉人进会话。

两个人要并行做不同模块时，仍然各开各的云端 Run，不要抢同一块未提交工作区。

Web 这一期不改交互。控制面 API 按 Desk 需要补，Web 现有的项目页先维持原样。

---

## 1. 设计原则

| 原则 | 含义 |
| --- | --- |
| Desk 先于 Web | 信息架构、状态机、权限、文案先在 Desk 锁死。Web 只做后置适配，不另开一套语义。 |
| 项目包上下文，任务包一次 Run | 项目不是聊天分组，也不是第二套 Agent。 |
| 共享的是项目，隔离的是 Run | 并行靠「各开各的对话」。同 Run 协作是例外，必须串行。 |
| 产物进项目是显式动作 | Run 工作区里的文件不会自动变成项目资产。项目资产只走用户在资产页手动上云。 |
| 看板给人排期，Agent 不擅自改列 | 卡片可以「开对话」。Agent 改状态只走用户明确触发的工具。 |
| 只有云端项目对话能拉人进会话 | 本机 Run、无 `projectId` 的对话，都没有「邀请加入这条对话」。 |
| 不抄办公套件 | 专家**市场**、技能市场、在线表格、人机双写、公开整段会话、公共 OAuth 票据共享，全部后置。专家角色包见 [workbuddy-experts.md](./workbuddy-experts.md)。 |

现网硬约束（设计时不许假装没有）：

- 应用机大约 **2 个 VM 槽**。多人并行靠排队 + 各开各的 Run，不承诺无限沙箱。空闲默认 **15 分钟**卸槽（`WORKER_IDLE_RELEASE_MS`，`0` 关闭）；槽会先把工作区写回 `hostRunsDir/<runId>` 再释放。下一任占用前会 `wipeMount`。详见 [附录 A](#附录-a运行时问答)。
- Agent loop 只在 VM 或本机 worker 里跑，控制面只编排。
- Provider Key 只在 gateway。转交、分享、资产都不得带出密钥。
- Desk 本机路径：`POST /v1/desks` 登记 → `start: "inline"` 自己起 或 `dispatch` 走 inbox 派 → `target: { loop: "desk", tools: "desk" }` → **用户选的那个文件夹本身**当工作区。P0–P2 不允许拆开 loop / tools。
- 会话权威在控制面。Desk 不做本地项目库、本地待办库。
- **不要为了「模拟 WB」再买一台 BTRFS / NBD 机器。** 协作语义挂在现有云端 Run 上，隔离盘用现成的 VM loop 槽。理由见 [§4.1](#41-要不要新开一台-btrfs-服务器)。

---

## 2. 现在已经有什么，缺什么

控制面第 0 期骨架已经在 `main` 上。Desk 只接了一半。

### 2.1 控制面（可复用，不要重写）

| 能力 | 现状 |
| --- | --- |
| `Project` | 名称、指令、`defaultRepoUrls`、`invitePolicy`（`open` / `approve`） |
| 成员 | `owner` / `admin` / `member`，上限 20 人，全站上限 40 个项目 |
| 邀请 | 链接 14 天；`open` 即加入，`approve` 先申请 |
| 直接加成员 | admin 可用邮箱加已有账号，或当场建同事账号 |
| Run 归属 | `projectId`、`assigneeUserId` |
| 指令注入 | 创建 Run 时写 `.neo/PROJECT.md`，worker 拼进 system prompt |
| 默认仓库 | 项目里开对话且没选手动仓库时，用 `defaultRepoUrls` |
| 可见性 | 成员只能列出并打开自己的本机项目对话、自己发起的云端对话、以及 `collaborators` 含自己的云端协作对话。仅凭 `projectHasMember` **不能**读别人的会话（列表 / transcript / SSE / 跟进一律 404）。项目 admin 也不能旁路。 |
| 转交 | `POST /v1/runs/:id/transfer` 只改 `userId` / `assigneeUserId`，**不复制 transcript，不打包产物** |
| 跟进队列 | `enqueueFollowUp` 已是 FIFO；RUNNING 走 `follow_up`，否则 `prompt` |
| 动态 | 项目对象里嵌 `events`，最多 40 条 |
| 产物 | Run 级 `neo_artifact_upload`，**没有项目级目录** |
| 看板 / 留言 | **没有** |

### 2.2 Desk UI（现在的壳）

独立 Agents Window，不是 Web 的 Diff / 终端 / 产物三标签。左侧 rail：New Chat / Search / Automations / Projects，会话树拆成 **对话（Inbox）** 和 **空间（项目 / 本机目录 / git remote）**。

已落地：

- 点项目进入工作台，默认停在 **任务**（没有单独的「概览」页）
- 工作台标签：任务 / 对话 / 资产 / 动态（含留言）/ 设置
- 云端建项目（`POST /v1/projects`），没有本地项目库
- 项目对话：面包屑、转交、流转待办；仅云端可邀请加入该会话
- 跟进队列条、收件箱小点
- composer 上的 Cloud / This Computer / 模型

本机目录只是 This Computer 的工作区，不能当成项目。项目资产由用户在资产页上传；工作区不会自动进项目盘。

### 2.3 Web（对照，不是这一期的活）

Web 已经能改指令、加成员、生成邀请、转交、看动态。Desk 设计冻结后，Web 按同一套 API 补看板 / 资产 / 留言，不要提前分叉。

---

## 3. 从 WorkBuddy 借什么

官方模型是两层：**项目包规范，任务包一次会话**。公开实战里真正能并行的，是「按可交付模块拆任务，每人一个独立沙箱」。

沙箱实测还补了三条硬事实，必须写进 Desk 产品：

1. **同会话协作是原地升级，不是搬到新工作区。** session、cwd、JSONL 不变，后加入的人往同一条链上追加。
2. **并发是柜台排队，不是水位并行。** 同一时刻只有一条 running；后到的人进队列。实测两条消息只隔 279ms，后来者等了约 19 秒。
3. **对话产物不等于项目资产。** 对话历史可以自动持久；`/workspace` 文件要显式上传到项目云盘，其他人才看得到。子卷休眠后文件可能没了。

### 3.1 跟

| WorkBuddy | Neo Desk |
| --- | --- |
| 项目指令 / 记忆 | `project.instruction` → `.neo/PROJECT.md` |
| 任务 = 对话 + 工作区 | 现有 `Run` + `projectId` |
| 分享 / 转交 / 多人进同一任务 | 项目内只读 + 跟进入队；转交要补交接包 |
| 房主制 | Run 的 `assigneeUserId` 是房主；成员能看、能排队发言（仅云 Run） |
| 计划看板 | 新实体 `project_todos`，卡片可开 Run |
| 资料库 / 项目资产 | 对象存储前缀 + 用户手动上传 |
| 留言板 | 项目级异步讨论，和 Todo 评论分开 |
| 产物流转 | 对话产物 → 待办附件 |

### 3.2 先不跟

专家**市场**、技能市场、连接器公共票据、腾讯文档双写、CSV/HTML 协同、`workbuddy.link`、锁屏远程本机、SSO / Credit、自定义工作流引擎、公开整站会话链接、本机待办 SQLite。Desk 专家选择器和项目钉住跟 [workbuddy-experts.md](./workbuddy-experts.md)，不另做市场。

Desk 也不先做 P3 并排窗格和 SSH 远程机。项目协同叠在现有 Cloud / This Computer 两轴上。

---

## 4. 核心对象

```text
Project
├── instruction / defaultRepoUrls / invitePolicy
├── members[]          owner | admin | member
├── invites[]
├── events[]           项目动态
├── todos[]            看板卡片（人排期）
├── assets[]           项目文件（显式发布）
├── messages[]         留言板（项目级）
└── runs[]             真正干活的会话
      ├── Cloud Run    VM 槽 + 共享 /workspace
      └── Desk Run     房主这台机器上、他自己选的那个文件夹
```

翻译表：

| WorkBuddy | Neo | 说明 |
| --- | --- | --- |
| 项目 | `Project` | 团队空间，不是 Environment |
| 任务 / 对话 | `Run` | 一次 Agent 会话 |
| 待办 / 计划 | `ProjectTodo` | 看板卡片，可挂 `runId` |
| 资料 / 资产 | `ProjectAsset` | 对象存储，不是 git |
| 留言 | `ProjectMessage` | 项目级；Todo 另有评论 |
| 任务产物 | Run artifacts + 工作区文件 | 默认出不了项目 |
| creator / editor | 房主 / 协作者 | 落在 Run，不落在项目角色上 |

一个人也可以建项目。项目不是「必须先有团队」才能用。

---

## 4.1 要不要新开一台 BTRFS 服务器

**不要。** WorkBuddy 沙箱里看到的 BTRFS 子卷 + NBD，是 CloudStudio Spacelet 的隔离盘实现，不是「多人协作」本身。协作测出来的事实是：

- 拉人进来之后 **sessionId / cwd / JSONL 文件都不变**（原地升级，不是搬到新工作区）
- 协作者 **没有自己的 Agent**，消息进发起人的队列，由发起人的 loop 执行
- `/workspace` 是这一条会话的盘，不是项目盘
- 对话历史自动持久；文件产物要显式上传

Neo 已经有对等物，不必再仿一套文件系统：

| WB 实测 | Neo 已经有的 | 还要补的 |
| --- | --- | --- |
| 一条对话 = 一个 BTRFS 子卷 | 一条云端 `Run` = 一个工作区。现网 `WORKER_RUNTIME=vm` 是 **loop ext4 槽**（默认 2 个），空闲写回再卸载；本地开发是 `RUNS_DIR/<runId>` | 不要换成 BTRFS |
| 同一份 session JSONL | worker 里 `SessionManager.create(cwd, sessionDir)` 只开 **一个** pi session；控制面还有同一条 Run 的 transcript | 协作者不要第二份 session |
| 流式同步 | 多客户端订同一条 `GET /v1/runs/:id/events` SSE，先拉 transcript 再跟 token | Desk 打开被邀请的 Run 时走这条，不要另开 WS |
| 发起人 workspace | `workspaceFor(runId)` / VM 槽挂载点，工具只打这份盘 | 协作者客户端不 mount 这台盘 |
| 发起人 Agent loop | 该 Run 上已有的那一个 worker + pi；`ACC` 等价物是 Run 的 `userId` / JWT | 不要给协作者再 spawn 一个 worker |
| FIFO 队列 | `enqueueFollowUp`：RUNNING 走 `follow_up`，否则 `prompt`；`session.isStreaming` 时后来者进 pi 队列 | Follow-up 补 `actorUserId`，UI 画出谁在跑、谁在等 |
| 邀请进当前会话 | 只有 **云端 + 带 `projectId`** 的 Run 能邀请；进会话的人进 `Run.collaborators`。未邀请的项目成员列表里看不到这条对话 | 不要再做成「先露卡片、点开再 toast」 |

新开一台「BTRFS 协作模拟机」会错在：

1. Agent loop 必须留在现有 worker / VM 槽里，不能再拆一个执行面。
2. 现网已经用 loop 槽做会话级隔离，再上 BTRFS/NBD/K8s Spacelet 是抄 CloudStudio 基础设施，不是抄项目协作。
3. 两端「共用 JSONL」是 **同一条 Run 的同一份 session + 同一份 transcript**，不是两台机器挂同一子卷。协作者的 Desk 只订 SSE，不 ssh、不挂载发起人磁盘。
4. 2 个槽已经被并行 Run 用着。协作 **不占第二槽**：加入的人挤进发起人已经占着的那一个。

本机 `This Computer` 对话：文件就在房主电脑上他自己的目录里，**禁止**「邀请加入这条对话」。要一起干活，先把对话开在 Cloud，或各开各的云端 Run。

---

## 5. 三层存储（对着 Neo 重画）

WorkBuddy 实测是沙箱子卷 / 对话历史上云 / 项目云盘三层。Neo 对齐成：

```text
第一层  Run 工作区                         会话级，默认不共享给项目里其他人
        Cloud: VM 槽 /workspace
        Desk:  用户授权的本机文件夹（就地）

第二层  控制面权威                          已持久，刷新/换机器还在
        Run 元数据、transcript、follow-up
        项目指令、成员、动态

第三层  项目资产                            要做，显式发布后项目成员可见
        对象存储 + project_assets 元数据
        待办附件、留言附件都引用这里
```

规则：

- 第一层 → 第二层：对话事件已经在走。Desk 本机 worker 的 session 备份沿用现有增量备份。
- 第一层 → 第三层：**绝不自动。** 只有用户在资产页手动上传。
- 第二层的 transcript 转交时可以复制给接手人；`.env`、`.neo/llm-upstream.env`、gateway 密钥不跟。
- 现网磁盘小。第三层走对象存储或库机盘，不进 VM 槽 ext4，也不进 Desk 用户仓库的 git。

Desk 本机还有第四个物理位置：用户选中的 git 文件夹。它**不是**项目资产。未提交改动做 handoff 时不跟随（现有 Desk 文案继续写死）。

---

## 6. Desk 信息架构

不把 Desk 改成办公后台。rail 四个入口不动。项目变成「带工作台的过滤器」，不是再开一扇独立 App。

```text
┌──────── rail ────────┬──────── 会话树 ────────┬──────────── 主舞台 ────────────┐
│ New Chat             │ 对话 (Inbox)           │  无选中项目：项目网格             │
│ Search               │ 空间                   │  选中项目：项目工作台             │
│ Automations          │  ├ 项目 / 本机目录     │    任务 | 对话 | 资产             │
│ Projects  ← 在这里选 │  └ git remote          │    动态 | 设置                    │
│ ────────             │                        │                                  │
│ 头像 / 收件箱 / 设置 │                        │  打开 Run：transcript + composer │
└──────────────────────┴────────────────────────┴──────────────────────────────────┘
```

### 6.1 项目列表（补全，不重做）

保持现有网格。每张卡片从「只有名字和添加日期」改成：

- 名称、成员数、最近一条动态时间
- 自己的角色徽章
- `⋯`：打开 / 在项目里开对话 / 复制邀请（管理员）

点卡片 = 选中项目并进入**项目工作台**，同时左侧树加上项目胶囊。现在这种「点了只过滤、舞台不变」要改掉。

空状态文案保持短句：还没有项目就引导新建。一个人用也成立。

### 6.2 项目工作台（Desk 新增的主表面）

选中项目后，主舞台默认停在工作台的 **任务** 页（实现里若路由写 `overview` 也会落到任务，不再单独做概览）。顶部标签：

| 标签 | 谁能看 | 现在的样子 |
| --- | --- | --- |
| 任务 | 全员 | 四列待办；没有卡片时引导新建或从对话流转 |
| 对话 | 全员 | 该项目 Run 列表：状态、房主、Cloud / This Computer、更新时间 |
| 资产 | 全员 | 用户手动上传的文件；工作区不会自动进来 |
| 动态 | 全员 | 项目事件 + 留言 |
| 设置 | 全员只读，admin 可写 | 名称、指令、默认仓库、邀请策略、成员、邀请链接 |

「在项目里开对话」落到现有 composer：`projectId`、项目 `defaultRepoUrls`、当前 Cloud / This Computer。本机目标仍要先选 git 文件夹。

从工作台点一条对话，舞台切到现有 chat-page，顶部加项目胶囊。`Cmd+W` 关会话后回到工作台，不回到全局 Chats。

### 6.3 对话页要多出来的项目铬

现有 `stage-head` 只有标题和云图标。项目 Run 要补：

```text
[项目名]  ·  交给 学业开摆人  ·  Cloud|This Computer
[分享] [转交] [流转为待办] [保存产物到项目]
```

本机 Run **没有**「邀请加入这条对话」。按钮隐藏，或点了只提示：改到 Cloud 再拉人。

用户气泡要能看出是谁发的（`follow-up` 带 `actorUserId` / `actorEmail`）。现在 transcript 里 user 消息没有发送者，协作对话会糊成一个人在说。

### 6.4 搜索

现有 Search Palette 已能搜到项目名。补三类结果，仍在同一 palette，不做第三个窗口：

- 对话（已有）
- 项目
- 待办（看板落地后）

### 6.5 本机目标与项目默认仓库

优先级（创建 Run 时）：

1. 用户在 This Computer 下选中的文件夹
2. composer 里选中的仓库
3. 项目 `defaultRepoUrls`
4. Inbox（无仓库）

设置页增加「项目默认仓库」。Cloud 用 git URL；This Computer 只允许已经是 git 的本地路径写进项目，供房主自己下次复用，**不把这台机器的绝对路径同步给其他成员**。其他人看到的是仓库名，不是 `/Users/you/...`。

---

## 7. 成员、邀请、角色

项目角色继续用现有三档。Desk 把 Web 已有的流程做成桌面交互，不改语义。

| | owner | admin | member |
| --- | --- | --- | --- |
| 改名称 / 指令 / 默认仓库 / 邀请策略 | ✅ | ✅ | ❌ |
| 加成员、审批、踢人（不能踢 owner） | ✅ | ✅ | ❌ |
| 发邀请链接 | ✅ | ✅ | ✅ |
| 开自己的对话；看见自己的本机 / 自己发起的云端 / 被拉进的协作对话 | ✅ | ✅ | ✅ |
| 未邀请就看见或打开他人会话 | ❌ | ❌ | ❌ |
| 被邀请后进入云端项目对话（共用 session） | ✅ | ✅ | ✅ |
| 建待办、留言、上传资产 | ✅ | ✅ | ✅ |
| 改别人的待办 / 删别人的留言 | ✅ | ✅ | ❌（自己的可以） |
| 转交任意对话 | ✅ | ✅ | 自己是房主的可以 |

邀请：

- `createProject` 未显式传 `open` 时默认 `approve`。Desk 新建也显式带 `invitePolicy: "approve"`。设置里仍可切回 `open`。
- 链接复制到剪贴板。Desk 深链：`neo://invite/<token>`；同时给一条 https 备用（现有 `/#/invite/<token>`），方便还没装 Desk 的人先用浏览器入会。
- Desk 启动或从背景唤起时，若带 invite token，先登录再走现有 `POST /v1/invites/:token`。
- 待审批出现在项目设置 + 轻量站内收件箱（见 §11）。

不做：企业 SSO、部门同步、项目级 Credit。

---

## 8. 三种任务协作（必须拆开）

WorkBuddy 的「分享 / 转交 / 多人协作」不是同一种操作。**进同一条会话干活**只允许发生在云端项目对话上，执行模型按 WB 沙箱实测锁死。

### 8.0 云端项目对话 = 共享 Agent（完整协作）

前置条件，缺一条就不给「邀请加入」：

1. Run 带 `projectId`，且被邀请人已经是该项目成员  
2. `executionTarget.loop === "cloud"`（云端，不是 This Computer）  
3. 邀请人是这条对话的房主（`userId` / `assigneeUserId`）或项目 admin  

加入之后，两端看到的是**同一条会话**，不是复制出来的第二条：

```text
发起人 Desk / Web          协作者 Desk / Web
        │                         │
        │   同一 runId             │
        ├──── GET /transcript ────┤   先拉已有消息（控制面编译稿）
        ├──── SSE /events ────────┤   同一条事件流，token 两边一起长
        │                         │
        └──── POST /follow-ups ───┘   都进同一 FIFO
                         │
                         ▼
              控制面 inbound 队列
                         │
                         ▼
         发起人的那一个 worker + pi session
         cwd = 发起人云端 workspace（VM 槽）
         SessionManager 只写这一份 JSONL
                         │
                         ▼
              工具打发起人的 /workspace
```

产品规则（和 WB 一一对应）：

| WB 实测 | Neo 锁定 |
| --- | --- |
| 拉人后 sessionId / cwd / JSONL 不变 | `runId` 不变，不新建 Run，不拷 session |
| 协作者没有独立 Agent | 不给协作者 spawn worker，不另占 VM 槽 |
| 消息进 creator 的 queue | `POST /v1/runs/:id/follow-ups`，带 `actorUserId` |
| 同时只有一条 running | 现有 FIFO；RUNNING 时后来者排队 |
| JSONL 里没有稳定 sender 字段 | 发送者写在 Follow-up / `user.message` 上，不写进 pi JSONL 冒充系统字段 |
| 流式两边同步 | 只扇出控制面 SSE，不让两端各读一份 worker JSONL |

「共用 JSONL」的准确含义：

- **权威会话**是发起人 workspace 里那一份 pi session（`SessionManager.create(cwd, sessionDir)`）。
- **两端 UI** 不直接打开这个文件。它们读控制面 transcript + SSE。控制面事件就是这份 session 的投影。
- 不要做「两个客户端 mount 同一 BTRFS、一起 tail JSONL」。那是把 CloudStudio 的盘协议搬过来，Desk 没有这条路径。

Desk 队列条（对话页顶部，有人排队或正在跑时出现）：

```text
正在处理 学业开摆人 的跟进
下一条：飞天大兔（已等 12s）
房主可见：[停止当前回合]
```

控制面增量：

- `Run.collaborators[]`：`userId` + `role`（`host` / `editor`）+ `joinedAt`  
- 创建云端项目 Run 时，发起人自动是 `host`  
- `POST /v1/runs/:id/collaborators`：只接受项目成员；非云端或无 `projectId` 返回 400  
- `FollowUp` 增加 `actorUserId` / `actorEmail`  
- `user.message` / `followup.queued` 带上发送者  
- `GET /v1/runs/:id/follow-ups` 给 UI 画队列  
- 写跟进、订 SSE、看 transcript、出现在列表：房主 / assignee / `collaborators` 里的人（自动化仍按原规则）。未邀请的项目成员 **看不到卡片**，`GET` / transcript / SSE / follow-up 一律 **404**。不要做灰卡片或点开 toast。

`actorCanAccessRun` 已去掉 `projectHasMember`。D2 只增加第三条路径（`collaborators`），不回头做成成员通读。

不做：插队、重排、暂停整条队列、给协作者第二份 JSONL、第二槽、第二 Agent。

### 8.1 并行（各开各的云端 Run）

同一项目下，两个人各自 `POST /v1/runs`（都走 Cloud）。文件系统隔离，各占各的槽（或排队等槽）。

这是公开实战里能跑通的「按模块拆」。概览上两句话并列：

- 同一件事一起改：邀请加入这条云端对话  
- 不同模块同时做：各开各的云端对话  

槽满时沿用现有排队，文案写成「云端席位忙，已排队」。不要引导两个人点进同一条本机 Run。

### 8.2 谁不能被拉进会话

| 对象 | 邀请加入这条对话 |
| --- | --- |
| 云端 + `projectId` 的 Run | ✅ 项目成员 |
| 本机 This Computer Run | ❌ |
| 没有项目的 Inbox / 个人对话 | ❌ |
| 非项目成员 | ❌ 先加入项目 |

### 8.3 转交（交接，不是改个字段）

现在的 `transfer` 只改归属。WorkBuddy 会打包产物、进度摘要、自定义字段；官方还写过「完整上下文复制到新会话」。现网转交后白屏、日期丢失的教训说明：转交是一次**交接包**，不是 update 一行。

Desk 第一期把转交收成两种，文案必须写清「对话记录会交给对方」：

| 模式 | 何时用 | 行为 |
| --- | --- | --- |
| 换房主（默认） | Cloud Run，接手人继续这条会话 | 改 `userId` / `assigneeUserId`；写交接摘要事件；原作者仍因项目成员可只读 |
| 开新会话交接 | 本机 Run，或用户勾选「给对方开一条新对话」 | 新建 Run（默认 Cloud，除非对方在线 Desk 且自己选了文件夹）；写入交接摘要 + artifact 引用；原 Run 只读 |

交接包内容：

- 系统生成的进度摘要（可先用最近 transcript 截断 + 标题，后续再接模型摘要）
- 可选用户留言
- artifact 列表引用（不拷 `.env`）
- 若挂了待办：更新日期不丢，`runId` 指到新 Run 或仍指旧 Run（换房主时指旧）

本机 Run 不允许假装「把我这台电脑的文件夹交给对方」。未提交改动不跟随，和现有 Desk handoff 一致。对方要本机接着干，自己在自己的 Desk 上选文件夹，从交接摘要开新 Run。

---

## 9. 计划看板与待办生命周期

看板是给人排期的指挥面，不是第二套 Agent，也不要和 Automations 混页。

### 9.1 状态机

与 WorkBuddy 对齐，四态全互通，避免第一期就做自定义列：

```text
        创建 ──► claim（待开始）
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
      running    paused      done
      进行中      暂停        完成
          │         │         │
          └─────────┴─────────┘
              均可回到 claim
```

- 转入 `paused` 必须写 `pauseReason`
- 前端拖拽落点看 `allowedTransitions`，不要本地写死一份不同的图
- 优先级：`none` / `low` / `medium` / `high` / `urgent`
- 子任务第一期最多 **1 层**（`parentTodoId`）。WB 的 5 层先不做

### 9.2 卡片字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 单行 |
| `description` | 否 | Markdown |
| `status` | 是 | 见上 |
| `priority` | 是 | 默认 `none` |
| `assigneeUserIds` | 否 | 必须是项目成员 |
| `startAt` / `dueAt` | 否 | 日期 |
| `runId` | 否 | 关联的对话 |
| `source` | 是 | `manual` / `handoff` / `artifact` / `agent` |
| `labels` | 否 | 项目内自由字符串，先不做客制选项表 |
| `attachments` | 否 | 指向 `ProjectAsset` 或 Run artifact |
| `sort` | 是 | 列内顺序 |

评论、描述历史、AI 委派（`todo_delegate`）放到看板稳定之后。第一期评论只做扁平一条时间线，不做嵌套回复。

### 9.3 Desk 看板

四列，卡片显示标题、负责人、优先级、是否挂了对话、截止日期。拖到另一列 = `POST .../transition`。乐观更新，失败 toast 并回位。

卡片点开右侧抽屉（不要盖住整窗）：

- 描述、负责人、日期、关联对话
- 「在这条待办上开对话」→ `POST /v1/runs` 带 `projectId` + `todoId`
- 「打开已有对话」
- 附件、评论、活动

从对话页「流转为待办」见 §10。不要让 Agent 在用户没说「把这张标完成」时改列。

### 9.4 和 Run / Automation 的边界

| | Run | Todo | Automation |
| --- | --- | --- | --- |
| 是什么 | 一次 Agent 会话 | 人看的卡片 | 个人定时任务 |
| 可见性 | 项目成员 | 项目成员 | **仅创建者**（官方语义，保持） |
| 执行 | VM / 本机 worker | 不执行 | 到点开 Run |
| 挂项目 | 可选 `projectId` | 必属项目 | 可选 `projectId`，条目仍私有 |

定时任务以后按「我的 / 某项目」过滤，仍然不是看板。

---

## 10. 产物发现与流转为待办

这是 WorkBuddy「点击流转」在 Desk 上的对应物。目标：对话里刚产出的文件，用户最少操作就能变成团队待办，而不是本地下载再上传。

### 10.1 发现

| 来源 | Desk 怎么认 |
| --- | --- |
| `artifact.uploaded` | 已经在 transcript 里，最稳 |
| 对话页以后的产物标签 | 与 Web artifacts 面板对齐，Desk 补标签页时一并接入 |
| 本机工作区新文件 | 第一期**不做**目录监听。本机误伤太大，只提示用户点产物或选文件 |

「流转」按钮的候选列表 = 当前 Run 已上传的 artifacts。没有产物仍可建纯文本待办。

### 10.2 弹窗

```text
流转为待办                              [×]
任务进度摘要    （可改；默认用最近一轮 assistant 文本截断）
产物            已勾选的 artifacts，可去掉
标题            建议用对话标题 / 摘要首句
负责人          项目成员
开始 / 截止
优先级
              [取消]  [创建]
```

### 10.3 协调器（控制面一次做完，Desk 不自己编排三步）

WorkBuddy 客户端要串 `todo_create` + `netdrive.upload` + `todo_add_attachment`。Neo 不要让 Desk 编排：

```text
POST /v1/projects/:id/todos
{
  title, description, assigneeUserIds, startAt, dueAt, priority,
  runId, source: "handoff" | "artifact",
  artifactRefs: [{ runId, name }]
}
```

服务端：建待办 → 把 artifact 复制进项目资产（同一对象存一份新 key，或增加引用计数）→ 挂附件 → 写动态。部分附件失败时待办仍在，返回 `failedAttachments[]`，Desk toast 列出，允许重试。

创建失败则整笔回滚。不要先建半个待办再让 UI 补洞。

状态：`IDLE → PICKING → CREATING → COMPLETED | FAILED`。取消保留表单。

---

## 11. 资产、留言、收件箱

### 11.1 资产

每个项目一个前缀。还没有对象时列表为空，并写明原因：对话文件默认不出项目。

动作：

- **只有**用户在资产页手动上传（Desk 用系统文件框）
- 预览 / 下载（签名 URL，过期重签）
- admin 可删

工作区文件、Run artifact、Agent 工具都 **不会** 写进项目资产。新 Run 最多在 `.neo/PROJECT.md` 追加资产清单给 Agent 看，不把文件 checkout 进工作区。

权限跟人走：不是成员就看不到清单。Agent 不另做 ACL。

版本先用 `objectKey` + `updatedAt`，不做网盘历史。配额先做软限制（建议 1 GB / 项目），超了拒绝上传并写进动态，不做计费。

### 11.2 留言板

项目级异步讨论，适合公告和「不跟某一张卡片走」的话。Todo 评论继续留在卡片里。

- 顶层 + **一层**回复，不能再回
- Markdown；`@` 必须「正文有 `@名字` + `mentionUserIds`」双写，否则通知和 UI 会对不上
- 附件整量替换，编辑前先读再写
- 删顶层则级联回复
- 仅作者改自己的；admin 可删他人（比 WB 略宽，避免垃圾公告无人能清）

Desk 放在工作台「动态」旁的子视图，或动态页上半留言、下半系统事件。不要给每条 Run 再做一个留言板。

### 11.3 收件箱

复用现有 notify，不加第三个 IM。Desk 头像旁一个小点：

- 邀请我审批 / 我被邀请
- 待办派到我
- 留言 / 评论 @我
- 对话转交给我

点开落到对应项目 / 对话 / 卡片。Telegram / 微信已有的出口，事件类型对齐即可。

自动化通知仍只给创建者，不进项目成员动态。

---

## 12. Agent 怎么碰到项目

第一期 **人点 Desk，不先做 27 个 MCP 工具**。预留形状，避免以后改表。

控制面已经会做的：

- 系统提示前拼项目指令
- 工作区 `.neo/PROJECT.md`

明确后置：

- `todo_*` / `project_message_*` MCP
- 单端口 connector-proxy（WB 那种 Electron 内 HTTP 聚合）
- Agent 自动改看板

第二期若做工具，走现有 worker 扩展（`neo_artifact_upload` 同款），挂控制面 `/internal`，**不要**在 Desk 主进程再开一套 MCP 代理。Desk 前端继续打 REST；Agent 打内部工具。两套入口同一张表。

委派 AI（`todo_delegate`）更后。现有 `neo_subagent` 够用。专家团召唤面见 [workbuddy-experts.md](./workbuddy-experts.md)，不做市场。

---

## 13. API 与数据（Desk 要用的增量）

现有 `/v1/projects*`、`/v1/invites*`、`/v1/runs`、`/v1/runs/:id/transfer`、`/v1/runs/:id/follow-ups` 保持。下面是缺口。

### 13.1 建议表

`projects` / `project_members` / `project_invites` / `project_events` 已有（JSON 文件或 DB body）。增量：

**`project_todos`**

| 列 | 说明 |
| --- | --- |
| `id` | `todo_` 短 id |
| `projectId` |  |
| `title` / `description` / `status` / `priority` |  |
| `assigneeUserIds` | JSON |
| `startAt` / `dueAt` | 可空 |
| `runId` / `parentTodoId` | 可空 |
| `source` / `pauseReason` / `sort` |  |
| `createdBy` / `createdAt` / `updatedAt` |  |

**`project_todo_comments`**、**`project_todo_activities`**：评论与卡片时间线。活动类型对齐调研里的 `created` / `status_changed` / `assigned` / `comment_added` / `attachment_added`。

**`project_assets`**

`projectId`、`path`、`objectKey`、`size`、`contentType`、`createdBy`、`source`（`upload` / `run`）、`runId?`

**`project_messages`**

`parentId` 空 = 顶层；`mentionUserIds`；`mentionAll`；附件 JSON。

**`runs` 增量**

`todoId?`。`collaborators[]`（`userId` / `role: host|editor` / `joinedAt`）。`FollowUp` 增加 `actorUserId` / `actorEmail`。

**`automations` 增量（可并行、不挡看板）**

`userId` 必填，`projectId` 可空。没有这两列之前，Desk 定时任务不要做成「项目看板」。

权威源是数据库（已有 MySQL / Postgres 钩子则走 body 表或拆列；本地开发可先 JSON，和现在 `projects.json` 一样）。Git 归档待办是后置。附件只存对象存储引用。

### 13.2 建议路由

```text
# 项目（已有）
GET/POST /v1/projects
GET/POST /v1/projects/:id
POST     /v1/projects/:id/invites
POST     /v1/projects/:id/invites/:token/approve
POST     /v1/projects/:id/members
GET/POST /v1/invites/:token

# 云端项目对话：邀请加入（仅 cloud + projectId）
GET/POST /v1/runs/:id/collaborators
DELETE   /v1/runs/:id/collaborators/:userId

# 转交补包
POST /v1/runs/:id/transfer
     { toUserId, note?, mode: "reassign" | "fork" }

# 跟进（已有，补 actor；仅 collaborators 可写）
GET/POST /v1/runs/:id/follow-ups

# 看板
GET/POST /v1/projects/:id/todos
GET/POST /v1/projects/:id/todos/:todoId
POST     /v1/projects/:id/todos/:todoId/transition
GET/POST /v1/projects/:id/todos/:todoId/comments

# 资产
GET  /v1/projects/:id/assets
POST /v1/projects/:id/assets                  # 签传或直传
POST /v1/runs/:id/artifacts/:name/save-to-project

# 留言 / 收件箱
GET/POST /v1/projects/:id/messages
POST     /v1/projects/:id/messages/:messageId
GET      /v1/inbox
```

创建 Run 已支持 `projectId`。补可选 `todoId`：写入卡片并回写 `runId`。

Webhook、Telegram、GitHub 仍不进登录 `/v1`。要开进某项目，用项目里登记的 secret，不把公开入口改成要 cookie。

---

## 14. 分阶段（只排 Desk + 控制面）

原则：**先让第二个账号在 Desk 里感觉进了同一个项目，再做看板和网盘。**

### D0 — 语义冻结（本文件）

锁对象、三层存储、云端共享 Agent、**不新开 BTRFS 机**、本机/云差异、非目标。不改大 UI。

### D1 — 项目工作台

控制面几乎不用加表。Desk：

- 点项目进入工作台（任务 / 对话 / 资产 / 动态 / 设置）
- 改指令、默认仓库、邀请策略
- 成员、邀请链接、审批、直接加账号
- 左侧胶囊 + 对话列表带房主 / Cloud 标记
- 邀请深链

验收：A 建项目写指令，B 用邀请进来；B 在 Desk 看到同一段指令，能在项目里开自己的对话；B 的工作台 / 左侧树 **没有** A 已有的云端或本机对话，也打不开。

### D2 — 云端项目对话能拉人（共享 Agent）

- `Run.collaborators`；只有 `cloud + projectId` 能邀请项目成员
- `actorCanAccessRun` 在 D1 已收口为房主 / assignee / 自动化；D2 只加 `collaborators`。未邀请成员列表与打开都是 404，没有「先看卡片」
- Follow-up 带发送者；对话气泡分人
- 队列条：谁在跑、谁在等；不新开 worker、不占第二槽
- 两端订同一条 SSE，读同一份 transcript（pi JSONL 只在发起人 workspace）
- 本机 Run 没有「邀请加入」
- 转交：云端 `reassign` 把 host 交给对方，session 还是这一份；本机默认 `fork`

验收：A 在云端项目对话里邀请 B；B 打开后看到 A 已经打出来的字和正在流的 token；B 发跟进时若 A 的回合还在跑，B 进队列；worker 只有一份，cwd 仍是 A 的槽。本机对话上没有邀请按钮。

### D3 — 看板

- `project_todos` + 四列拖拽 + 抽屉
- 卡片开对话（带 `todoId`）
- 对话「流转为待办」（可以先不挂附件）
- 动态含状态变更

验收：看板上建卡 → 开出带项目指令的对话；对话里流转出一张待开始卡片。

### D4 — 资产与附件

- 项目资产列表、用户在资产页手动上传
- 工作区 / Run artifact **不会**自动或一键进项目盘
- 新 Run 的 `PROJECT.md` 可带资产清单（给 Agent 看目录，不拷文件）
- 签名 URL 过期重签

验收：A 在资产页上传 `MEMORY.md`；B 新开 Run 能在清单里看到；子卷清掉、本机文件删掉之后项目里还在。

### D5 — 留言与收件箱

- 留言板两层
- `@` 双写
- Desk 收件箱小点
- 自动化仍只给创建者

### 刻意后置

Web 整页适配；MCP 27 工具；AI 委派；Git 归档待办；自定义列；Desk 扫盘发现产物；并排窗格；SSH；专家/市场/双写/公开会话。

---

## 15. 第一张能交差的切片

D1 + D2 做完，Desk 就已经是「项目」而不只是过滤器：

1. 能建项目、写指令  
2. 能邀请第二个账号  
3. 在项目里开对话，指令自动带上  
4. A 把 B 拉进**同一条云端项目对话**：共用 transcript / SSE / 发起人 workspace / 发起人 Agent；并发跟进排队  
5. 本机对话不能拉人；要一起改文件，先开在 Cloud  

看板和资产是放大器。没有这五步，网格再好看也只是标签。

---

## 16. 风险

| 风险 | 为什么 | 怎么收 |
| --- | --- | --- |
| 两人同时跟进打乱 pi | 双 `steer` | 全部入现有队列；UI 显示对方正在说 |
| 为模拟 WB 新开 BTRFS 机 | 抄的是 Spacelet 磁盘，不是协作语义 | 用现有 VM loop 槽 + 同一 Run；协作者只订 SSE |
| 给协作者第二份 JSONL / 第二槽 | 变成两条会话 | 禁止 spawn 第二个 worker |
| 项目成员自动能跟进所有对话 | 旧实现用 `projectHasMember` 通读 | 已删该条；只保留房主 / assignee / collaborators / 自动化 |
| 把本机工作区当成可分享沙箱 | 文件只在房主电脑上 | 本机禁止邀请加入；转交默认 fork |
| 转交拷走密钥 | transcript / 工作区可能有 `.env` | 沿用打码；交接不拷 `.env` / `llm-upstream.env` |
| 产物当永久盘 | WB artifact 管道关着，子卷会丢；Neo 槽会卸 | 用户手动上云；文案写「对话文件不会自动进项目」 |
| 2 个槽被并行打满 | 各开各的 Run 是对的，但会排队 | 产品写排队，不写无限并行 |
| 看板做成第二套 Agent | 和 Run、Automation 搅在一起 | 三张表、三个入口 |
| 办公套件回潮 | 范围会散 | §3.2 / §14 后置名单不准偷偷做 |
| 乐观更新闪一下 | 拖拽失败 | toast + 回位 |
| 签名 URL 过期 | 附件 60 分钟级 | 401/403 自动重签 |
| Web 提前分叉 | 两套语义 | Web 适配单独立项，跟这份冻结稿 |

---

## 17. Web 后置（现在只记账，不设计交互）

Desk 的 D1–D5 冻结后，Web 再做：

- 现有项目页换成与 Desk 相同的标签（任务 / 对话 / 资产 / 动态 / 设置）
- 对话页补分享、转交、流转、队列条
- 邀请继续用 `/#/invite/:token`
- 手机宽度沿用现有触控尺寸，看板改卡片流，不在窄屏上硬做四列拖拽

在此之前不要给 Web 单独加看板表结构。合约只有一份。

---

## 18. 资料与代码锚点

| 主题 | 位置 |
| --- | --- |
| WorkBuddy 该跟 / 不该跟 | [workbuddy-project-collaboration.md](./workbuddy-project-collaboration.md) |
| WorkBuddy 专家 / 专家团 | [workbuddy-experts.md](./workbuddy-experts.md) |
| Desk 已落地执行面 | [desk.md](./desk.md) |
| 项目合约 | `packages/contracts/src/project.ts` |
| 项目存储 / 邀请 | `packages/control-plane/src/projects/store.ts` |
| 指令注入、转交 | `packages/control-plane/src/orchestrator/orchestrator.ts` |
| 项目 API | `packages/control-plane/src/api/server.ts` |
| Desk 项目列表 | `packages/desk/ui/pages.tsx` `ProjectsPage` |
| Desk 过滤与创建 Run | `packages/desk/ui/App.tsx` |
| Web 已有成员/转交（对照） | `packages/web/src/components/ProjectsPage.tsx` |
| 本机工作区 | `packages/desk/src/workspace.ts` |
| 跟进队列 | `enqueueFollowUp` |
| 用户提供的 WB 实测材料 | 项目协同架构图、沙箱生命周期、待办 / MCP / 留言板 / 产物流转文稿 |

---

## 19. 实现时不要做的事

- 不要新开 BTRFS / NBD / Spacelet「协作模拟服务器」。
- 不要给协作者第二份 session JSONL、第二个 worker、第二槽。
- 不要让两端直接 mount 或 tail 发起人磁盘上的 JSONL；UI 只走 transcript + SSE。
- 不要在 Desk 主进程做待办 SQLite「加速缓存」当权威源。
- 不要为了协作把两个人的本机 Agent 指到同一个文件夹。
- 不要自动把 `/workspace` 或本机工作区同步进项目资产。
- 不要把 Automations 画进看板列。
- 不要在第一期做 MCP 工具完整集「对齐 27 个名字」。
- 不要把 Web 项目页和 Desk 工作台做成两套字段名。

---

## 附录 A：运行时问答

对照现网代码，不是推测。

### A.1 槽到时间会不会自动释放？会不会有上一任文件干扰？

会自动释放，默认 **15 分钟**空闲。`WORKER_IDLE_RELEASE_MS` 没设就是 `15 * 60_000`；设成 `0` 则不卸槽。控制面每 2 秒扫一次 `expireIdleWorkers`：Run 已是 `IDLE`、还挂着 worker、且 `now - idleAt >= ttl` 才释放。释放时 **不标 ERROR**，只发 `Released idle VM slot`。

释放顺序（细则见 [workspace-persistence.md](./workspace-persistence.md)）：

1. `persistRunWorkspace`：槽上的用户文件拷回 `hostRunsDir/<runId>`（跳过 `node_modules` 等缓存）。失败则**留下槽**，发 `workspace.persist_failed`
2. 给 worker 发 `shutdown`
3. `destroy` worker，`releaseVmSlot`：`umount`，槽标 `idle`，`runId` 清空
4. 按预算 / TTL 回收别的空闲工作区
5. 有人在排队就 `tryStartQueued`

下一任占用同一槽时，`VmSlotRuntime.provision` 会先 `wipeMount`，再把 **这一条 Run** 自己的 host 工作区拷进去。所以：

| 担心 | 现网怎么处理 |
| --- | --- |
| 槽卸了对话是不是没了 | 不是。对话在控制面，工作区文件在 `hostRunsDir/<runId>` |
| 槽被 B 占用，A 的文件会不会混进 B | 正常路径不会。卸槽前按 runId 写回，占槽前 wipe，再只拷 B 的目录 |
| 同一条 Run 过一会儿又说话 | `resumeRun`：session 备份还原进新工作区，再占槽、拉 worker。槽可能是另一块盘 |
| 写回失败 | 空闲释放中止，槽还挂着，文件还在热盘上 |
| 磁盘满了 | 先回收 ARCHIVED / 最老的 IDLE 工作区（对话留下）。见工作区持久化文档 |

2 个槽限制的是 **同时挂着的执行面**，不是同时存在的对话数。空闲对话卸槽后，卡片还在，发跟进再排队占槽。

### A.2 对话 JSONL 除了工作区还有没有持久化？

有，而且 **UI 和恢复靠的是工作区外面那份**。工作区里的 pi session 只是 Agent 的热副本。

| 层 | 位置 | 写什么 | 谁读 |
| --- | --- | --- | --- |
| 热 session | worker `SESSION_DIR`（工作区 `sessions/`） | pi `SessionManager` 的 jsonl/json | 仅这一条 Run 的 worker |
| 控制面 session 备份 | `RUNS_DIR/.control/<runId>.session/` | worker 按工具次数 / 约 30s 增量上传；密钥会打码 | `resumeRun` / worker 启动时还原 |
| 事件日志 | `.control/<runId>.events.jsonl` | 每个 RunEvent 追加 | 重放、归档 |
| 编译稿 | `.control/<runId>.transcript.json` | 给 UI 的消息快照 | Desk/Web `GET /transcript` |
| 对象存储 | 默认 `.neo/runs/.objects`，可 S3 | 事件 + snapshot + session 再归档一份 | 控制面重启 / 冷恢复 |
| MySQL/Postgres | 设了 `DATABASE_URL` | Run 元数据镜像 | 现网权威元数据 |

两端协作 **不要**去读工作区 JSONL。流式同步走 SSE（事件已经 persist）。槽卸了、工作区被 wipe 了，对话记录仍在 `.control` 和对象存储。工作区 JSONL 丢了，靠 session 备份还原后再继续跑 Agent。

和 WB 的差别：WB 对话史每轮推到腾讯文档网盘，文件产物管道是关的。Neo 对话史已经在控制面 + 对象存储；项目文件只走用户手动上云。

### A.3 串行动态：Neo 现在 vs WB 参考

WB 实测（`queue.json`）：

```text
enqueued → dequeued → running（同一时刻只有这一条）→ prompt done
后来者进 items[]，按 enqueuedAt 纳秒排序
queueVersion 每次 +1，两边看到同一份
senderUserId 在队列里，不在 JSONL 字段里
creator 能停 / 重排 / 插队；editor 只能 send
```

279ms 内两条消息，后来者等了约 19s，等的是 **当前 Agent 回合跑完**，不是网络。

Neo 现网已经是「一条 Run 一个 loop」，但队列形态更粗：

```text
POST /follow-ups
  → inbound[] 追加（FIFO）
  → 若 RUNNING：delivery=follow_up；否则 prompt
  → worker pullInbox 一次把当前积压全取走
  → 逐条 dispatchInbound
       正在流：followUp / steer 交给 pi 内部排队
       没在流：session.prompt 开新回合
```

和 WB 对齐时要补的是 **可见性和身份**，不是再做一套 BTRFS 队列文件：

| | WB | Neo 现在 | Desk 协作要补 |
| --- | --- | --- | --- |
| 同时几条 running | 1 | 1（一个 pi session） | 保持 |
| 后来者去哪 | `items[]` 等到当前 end_turn | `inbound[]` + pi `followUp` | 队列条显示「谁在跑 / 谁在等」 |
| 发送者 | `queue.senderUserId` | Follow-up **没有** actor | `actorUserId` / 气泡分人 |
| 两端同看一份队列 | `queueVersion` 广播 | 各订 SSE，没有队列快照 | `GET /follow-ups` + `followup.queued` |
| 房主控制 | 停 / 重排 / 插队 | 有 abort，没有重排 | 第一期只做停止当前回合 |
| 等待体验 | 长任务会堵住后面的人 | 一样 | 文案写「对方的回合还在跑」 |

不要做成水位排序（两条跟进同时各跑一个 Agent）。不要在工作区里再写一份 `queue.json` 给两端去读。权威队列就是控制面 `inbound` / `followUps`，动态靠 SSE。
