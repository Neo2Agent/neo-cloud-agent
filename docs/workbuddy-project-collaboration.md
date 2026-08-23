# WorkBuddy 项目协作调研

落地现状（对照代码，不是本调研）：[定时任务](./automations.md) · [项目空间](./projects.md)。

调研日期：2026-08-22。  
对象：腾讯云 WorkBuddy（CodeBuddy 文档站里的「从入门到精通 / 项目」这一支，不是 IDE 里的 Plan Mode）。  
目的：弄清它的「项目协作」到底卖什么，再对照 Neo Cloud Agent 现在能做什么，给出一份能跟着做、又不照抄办公套件的落地顺序。

本文依据官方文档、更新日志和公开实战文整理。没有登录 WorkBuddy 客户端点过每一个按钮；文中把「官方写死的行为」和「第三方解读 / 建议模型」分开写。

主要来源：

- [项目](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)
- [任务管理](https://www.workbuddy.cn/docs/workbuddy/Task-Management) / [创建任务](https://www.workbuddy.cn/docs/workbuddy/Create-Task)
- [资料库](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library) / [内容管理](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Content-Management) / [多人多 Agent 协作](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Collaboration)
- [连接器](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector) / [专家](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Expert-Center) / [技能](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)
- [默认权限与安全沙箱](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes) / [人机双写](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Knowledge-Base/Cowriting)
- [更新日志](https://www.workbuddy.cn/docs/workbuddy/Changelog)
- [用 WorkBuddy 做产品原型：多人并行 AI 协作实录](https://cloud.tencent.com/developer/article/2688477)

---

## 1. 一句话结论

WorkBuddy 的项目协作不是「多开几个聊天窗口」，而是加了一层 **项目空间**：

> **一个项目 = 共享上下文（指令 / Skill / 专家 / 连接器 / 资料）+ 一块计划看板 + 一座资产库 + 一组成员权限 + 一堆可分享 / 可转交 / 可多人进的任务。**

任务才是一次真正干活的会话：一个人提需求，Agent 在独立工作空间里跑，产物可以回写资产库，也可以连同对话摘要交给别人接着干。

对 Neo 来说，值得跟的是这套 **「项目包上下文，任务包一次 Run」** 的分层，不是腾讯文档、积分、专家中心、锁屏远程电脑那些办公套件。

| 该跟 | 先别跟 |
| --- | --- |
| 项目 / 任务两层 | 腾讯文档人机双写、`workbuddy.link` 发布站 |
| 项目指令自动注入每次对话 | 专家中心 / 专家团市场 |
| 邀请成员 + 管理员审批 | 公共授权连接器票据云端共享 |
| 任务分享链接、转交（上下文打包） | 桌面沙箱、锁屏远程、整理本机桌面 |
| 项目资产（人上传 + Run 产物回写） | MD / CSV / HTML 三件套在线协同编辑 |
| 计划看板（待办 ↔ Run） | 企业 SSO / Credit / VPC 专享版 |
| 项目动态 + 消息中心（精简版） | 技能市场、订外卖类 Skill |

---

## 2. 产品定位：它和 Neo 不是同一类东西

WorkBuddy 是腾讯云的 **企业 AI 办公工作台**：桌面客户端 + Web + 小程序 + 微信 / 企微 / 钉钉远程下发。2026-06-03 的 5.0.0 把 Teams 做成系统能力；企业版宣传口径是「数字员工 + 人机协同项目 + 管理后台」。

它默认在 **用户电脑的工作空间** 里读写文件，外面再套沙箱和二次确认。云端项目会话存在，但「数据本地执行不上传」是企业安全卖点之一。连接器对接的是 QQ 邮箱、腾讯文档、乐享、会议、TAPD、腾讯网盘。

Neo Cloud Agent 是 **Cursor Cloud Agent 克隆**：控制面编排隔离 VM，pi-coding-agent 在槽里跑，LLM 走网关。现在已经有：

- 账号登录（现网手输，不预填）
- 对话 Run、跟进、子 Agent
- Environment / Build / 工作区 skills
- 定时任务（`source: automation`）
- Telegram / 微信公众号入口，做完可通知
- GitHub webhook 唤醒
- Run artifacts

`Run` 合约里已经有 `orgId` / `userId`，但产品面上还是单人对话列表，没有「项目」这一层。

所以跟 WorkBuddy，是跟 **人 + Agent 怎么在一个项目里共事**，不是把 Neo 改成办公助手。

---

## 3. 核心模型：项目包规范，任务包一次干活

官方把协作收成两层：

| 层 | 官方定义 | 对应直觉 |
| --- | --- | --- |
| 项目 | 团队的核心协作阵地。把指令、连接器、专家、技能、资料统一组织。成员在项目里开任务时，这些配置自动注入 | 团队空间 / 共享规范 |
| 任务 | 项目成员创建的对话会话。一个任务 = 一个对话 + 一个工作空间。支持分享、转交、多人协作 | 一次 Agent Run |

项目详情页底部有任务输入框，直接打字就创建任务。创建时自动注入：

1. **项目指令**：拼进模型上下文
2. **项目资料库**：以 reference 形式进入
3. **个人记忆**：拼进上下文

任务里可选范围（项目级置顶）：

| 配置 | 选择范围 | 排序 |
| --- | --- | --- |
| 专家 | 项目专家 + 个人专家 + 专家中心全部 | 项目专家置顶 |
| Skill | 项目 Skill + 已安装 Skill + 现场导入 | 项目 Skill 置顶 |
| 连接器 | 已连接的公共授权 + 项目个人授权 + 连接器管理页 | 公共授权置顶 |

创建项目可用模板：选模板后预填指令、连接器、Skill、专家，再改。

**跟做时的翻译：**

- 项目 ≈ 一组人共享的 `instructions` + 默认 `repoUrls` / Environment + 项目级 skills + 资产目录
- 任务 ≈ 现在的 `Run`，多一个 `projectId`
- 不要先做专家中心。项目指令 + 工作区 `AGENTS.md` / `.neo/skills` 已经能覆盖「团队行为规则」

---

## 4. 项目配置：共享的是「AI 怎么干活」，不是聊天记录

官方列出的公共配置：

| 字段 | 作用 |
| --- | --- |
| 名称 | 项目标识 |
| 指令 | 对 AI 的全局行为规则，所有任务自动继承 |
| 连接器 | 项目可用的外部服务 |
| 专家 | 项目可召唤的领域角色 |
| 技能 | 项目可调用的技能包 |

这些配置存在云端，项目成员共享。

连接器按授权拆成两类，这是协作里最容易踩的坑：

| 授权 | 票据在哪 | 谁能用 | 适用 |
| --- | --- | --- | --- |
| 公共授权 | 管理员配一次，全员共用同一套票据 | 协作任务里 **只能用这个** | 团队共享账号（文档库、通知机器人） |
| 个人授权 | 成员各自授权，票据留在本地，不上传云端 | 协作任务里 **全部禁用** | 私人邮箱、私人网盘 |

同一个连接器可以两种授权同时存在：管理员挂团队飞书，成员再挂自己的飞书。

官方反复强调：开启多人协作前，先确认项目已经配好公共授权连接器，否则协作者进任务会发现工具全灰。

**跟做时的翻译：**

- 项目指令写成一段系统提示，创建 Run 时拼到 worker 系统提示前面
- 项目 Skill = 工作区 `.neo/skills` 或控制面登记的项目技能，不要加载宿主机 `~/.pi`
- 连接器先只做「项目级通知 / GitHub / 仓库凭据」，不要做 OAuth 票据全员共享。Neo 的 LLM Key 必须继续只活在网关

---

## 5. 成员、邀请、角色

### 5.1 进项目

官方流程：

1. 任一成员在项目详情右上角点邀请，复制链接
2. 被邀请人打开链接，填备注，提交申请
3. **管理员**在消息中心审批

后来的更新日志加了「邀请链接免审直接加入」。两套都要能配：默认审批，内测可以免审。

微信分享邀请页会带上邀请人名称。

### 5.2 项目角色（官方项目页）

文档没有列出完整 RBAC 表，能确定的是：

- 任何人都能发邀请
- **放不放人进项目，由管理员决定**
- 项目级 Skill / 专家 / 连接器 / 指令的编辑，按角色管控
- 任务产物的操作权限 = **任务角色 ∩ 项目角色**

第三方解读常用 `admin` / `member`：管理员改指令和连接器、管人；成员只能调用。跟做时先用这两档就够。

### 5.3 资料库空间权限（另一套，别混）

资料库「团队空间」是四档，管的是 **文件**，不是项目配置：

| 档位 | 能做什么 |
| --- | --- |
| 查看 | 只能看 |
| 编辑 | 新建、改、整理 |
| 管理 | 管成员和权限 |
| 无权限 | 进不去 |

关键原则：**Agent 跟人同一套权限。** 人看不到的，Agent 也读不到。不用给 Agent 单独做 ACL。

### 5.4 企业层（先不做）

FAQ / 企业版还讲 SSO、组织架构同步、按部门 Credit、IP 白名单、Skill 安全审计、VPC 专享。那是腾讯云售卖面，不是第一期项目协作。

---

## 6. 任务：三种协作，不要做成一种

官方原文：「支持分享、转交和多人协作三种模式」。这是产品核心，跟的时候必须拆开。

### 6.1 分享

任务对话顶栏「邀请成员」，复制链接。对方打开就进 **当前会话**。

个人任务列表里还有「分享到任意渠道，生成公开链接」。项目里的分享更像定向给成员；公开链接是另一条、权限更松的路。

Neo 现在的对话是登录后按 token 看自己的 Run。第一期做 **项目内只读 / 可跟进链接** 就够，不要一上来做全世界能打开的公开会话。

### 6.2 转交（任务流转）

把任务连同上下文移交给别人。顶栏点流转，系统打包：

| 内容 | 说明 |
| --- | --- |
| 任务产物 | 这次任务里 AI 生成的全部文件 |
| 任务进度摘要 | 系统自动写的执行总结 |
| 自定义字段 | 标题、描述、处理人、状态、截止日期（可改） |
| 附加附件 | 接手人可能还要的补充材料 |

接收方打开后，基于完整上下文继续，不用再听一遍背景。官方安全说明写得更重：转交会把 **原任务完整上下文（对话、调用记录、中间产物）复制到新会话**。

更新日志里修过：转交后计划栏开始日期丢失、转交后白屏、转交待办不展示。说明转交不是改个 `assignee` 字段，而是一次 **会话复制 + 所有权切换**。

**跟做时的翻译：**

- 转交 = 新 Run（或同一 Run 换 `userId`）+ 复制 transcript + 复制 / 挂上工作区快照 + 写一条交接摘要
- 现网 VM 槽只有 2 个。转交不要假设两个人同时占槽；默认交的是 **已结束或可恢复的会话**，接手人再唤醒

### 6.3 多人协作对话

更新日志原话：多成员实时协同、**队列派发与排序**。

这不是两个人同时打字改同一段 Agent 输出。更像：

- 多个人都能进同一个任务看 transcript
- 跟进消息排队，避免两个人同时 `steer` 把 loop 打乱
- 协作任务禁用个人授权连接器

Neo 已经有 Redis 跟进队列。多人协作的第一刀是：**同一 Run 允许多个登录用户读 SSE，写跟进必须入队**。不要做 OT / 光标同步。

### 6.4 任务生命周期（个人任务列表）

侧栏分「任务」和「空间」。状态：

| 状态 | 含义 |
| --- | --- |
| 规划中 | 在分析需求、整理思路 |
| 待处理 | 等用户再输入 |
| 进行中 | 正在执行 |
| 已完成 | 跑完 |
| 失败 | 中途出错 |
| 已归档 | 收起来以后查 |

操作：置顶、打开文件夹、重命名、保存到工作空间（可开多个 Agent 同时协作、用 IDE 打开）、分享、删除、归档。失败或中断都可以回任务里继续说，接着上次的上下文。

对照 Neo 的 `RunStatus`（`NOT_YET_STARTED` / `PROVISIONING` / `INSTALLING` / `RUNNING` / `IDLE` / `WAITING_FOR_BACKGROUND_WORK` / `ERROR` / `ARCHIVED` / `EXPIRED`）：语义已经够用，缺的是项目归属、处理人、截止日期、分享和转交。

---

## 7. 计划看板：指挥中心，不是第二套 Agent

5.0.0 上线项目计划看板：待办创建、状态流转、批量操作。  
5.3.3 重构：待办富文本、评论里粘贴图片、动态留言。

看板是给人排期的。卡片可以挂处理人、状态、日期，也可以和某个任务（会话）关联。转交任务时，看板上的日期曾经丢过，说明官方想让 **看板卡片和任务会话打通**，但两边不是同一张表。

公开实战文里的用法：产品负责人先按页面模块拆计划，再各自开独立会话设计，最后整合。拆任务的原则是 **按模块拆，不按职能层拆**，这样两人才能真并行。

**跟做时的翻译：**

- 看板卡片是轻量记录：`title` / `body` / `status` / `assignee` / `dueAt` / `runId?`
- 从卡片「开对话」= `POST /v1/runs` 并带上项目指令
- 不要让 Agent 直接改看板列，除非用户明确说「把这张卡片标完成」

建议列：`todo` / `doing` / `done`（可再加 `blocked`）。不要一上来做自定义工作流引擎。

---

## 8. 资产库和资料库：两套表面，一个目的

文档里有两个接近的词，跟的时候要分清：

### 8.1 项目资产（项目页「资产」标签）

每个项目一座资产库。成员手传，也可以把任务产物存进去。资料以 **RAG** 注入任务；Agent 也可以 `read-file`。

容量：默认 **5 GB / 项目**，走腾讯网盘。工具栏显示已用 / 总量。列表有更新人、更新时间。5.0.0 还写了文件夹、版本历史、任务内引用。

文件过滤：文档、表格、幻灯片、PDF、图片、视频、音频、网站书签、Markdown、其他。

上传来源：

- 本地文件
- 任务产物预览里「上传到云端」

### 8.2 资料库（左侧独立入口）

这是更大的「人与 Agent 共同产物存放地」，分成：

- **我的文档**：个人默认落点
- **团队空间**：项目共享，可嵌套目录树

官方反复讲的闭环：

```
资料库选目录/空间 → 添加到任务 → Agent 读同一权限的资料干活 → 成果存回资料库
```

和普通网盘的差别，他们押在 **MD / CSV / HTML 三件套**：

| 形态 | 职责 | AI 怎么改 |
| --- | --- | --- |
| MD | 内容、叙事 | 划词出修订建议，人点接受才写正文 |
| CSV | 唯一数据源 | 在线表格，多人同时改 |
| HTML | 呈现，按表格 ID 渲染 CSV | 划词直接改，多人光标可见 |

另有「发布为网站」（`workbuddy.link`，默认关）、剪藏网页、人机双写（腾讯文档内核改 Word / Excel / PPT / MD）。

**跟做时的翻译：**

Neo 不要先做在线表格和协同 HTML。第一期资产库就是：

1. 项目下一个对象存储前缀（已有 artifacts 管道）
2. 人上传 / Run 产物「保存到项目」
3. 新 Run 把资产清单当 reference 塞进提示，或 checkout 进工作区只读目录（例如 `/workspace/.neo/assets`）
4. 版本先用对象存储 key + `updatedAt`，不要自研网盘

Agent 权限跟当前用户走：没有项目读权限就不要把资产挂进 VM。

---

## 9. 项目动态、消息中心、外部数据

### 9.1 项目动态（三类）

| 类别 | 事件 | 可见性 |
| --- | --- | --- |
| 与我有关 | 别人把任务定向分享或转交给我 | 当事人 |
| 成员动态 | 上传/更新文件、邀请、公开任务、增删 Skill/专家/连接器、改指令 | 项目成员 |
| 自动化 | 自己建的自动化通知 | **仅自己** |

还有项目动态时间线：成员操作、待办状态变更。

### 9.2 消息中心

聚合：项目邀请、审批、动态。更新日志修过「消息中心不弹项目申请」。

Neo 已有 Telegram / 企微 / HTTP 通知。第一期消息中心可以是站内列表 + 复用现有 notify，不必做第三个 IM。

### 9.3 外部数据源

5.0.0：项目外部数据源，**定时导入 + Webhook 触发**。

这和 Neo 已有的 GitHub webhook、定时任务很像。跟的时候把它收成「项目级触发器」：cron 或 webhook 在 **某个项目** 里开 Run，而不是全局再挂一套。

### 9.4 项目里的自动化

官方说自动化是特殊任务：到点跑一段 prompt，推通知。形态目前只有定时。  
**自动化是个人级的，只有创建者看得见、管得了。** 所以它会出现在「与我有关 / 自动化」里，不会出现在成员动态。

Neo 现在的定时任务是整站一份列表，没有 `userId` / `projectId`。跟项目协作时要改成：默认个人，可选挂到项目（若挂到项目，跑出来的 Run 进该项目，但自动化条目仍可按官方做成创建者私有）。

---

## 10. 专家、专家团、Skill：别和项目层搅在一起

官方对照：

| | Skill | 专家 | 专家团 |
| --- | --- | --- | --- |
| 是什么 | 工具能力 | 人设 + 方法论 + 工具链 | 团长拆解、并行、汇总 |
| 何时用 | 要能干某件事 | 单点领域问题 | 复杂、要多角色 |

专家本身不抢系统权限；绑了 Skill / MCP 才间接触达文件或外部服务。专家团积分大约是单专家的 3–5 倍。

项目页允许挂「项目专家」，任务里还可以 `@` 自建专家和子助理（更新日志）。

Neo 已有 `neo_subagent`（scout / planner / reviewer / worker，single / parallel / chain）。这已经覆盖专家团的「拆开并行再收回来」，不必再做专家市场。项目协作第一期只用 **项目指令 + 项目 skills + 现有 subagent**。

---

## 11. 安全模型：两套「权限」，跟的时候只借思路

### 11.1 桌面任务权限（默认 / 完全放开）

默认权限：工作空间内低风险写入可以走，敏感路径、批量删除、脚本、网络要确认。  
完全放开：关掉二次确认，只建议在隔离目录 / Docker / VM 里短时间开。

这是 **本机 Agent** 的护栏。Neo 的隔离已经在 VM 槽 + egress + 网关 JWT，不要再在对话页做一套「完全放开本机」。

可借的思路：项目里给 Run 标一个 `permissionMode`（例如只读工作区 / 默认可写 / 允许推 PR），映射到现有 egress 和 SCM。

### 11.2 协作安全（和项目直接相关）

- 项目配置云端共享；个人连接器票据不上传
- 协作任务禁用个人连接器
- 资料库 Agent 不越权
- 公共授权连接器的调用日志只给管理员看
- 转交会复制完整上下文，等于把对话史交给接手人——产品文案里要写清楚
- Web 和个人客户端的个人 Skill 库不通，项目级 Skill 云端统一

Neo 现网不要把 Provider Key、`.env`、GitHub PAT 放进可转交的 transcript。转交前打码（架构里已有 transcript 打码方向）。

---

## 12. 他们怎么真正一起干活（公开实战）

腾讯云开发者社区有一篇安全监管平台原型实录，流程比功能清单更有用：

1. 建项目  
2. 把背景写进 **项目记忆**（业务、术语、规范）  
3. 负责人按 **页面模块** 拆计划  
4. 邀请链接拉人，对方看到同一份上下文 / 任务 / 文件  
5. 两人在同一项目下 **各自开独立 AI 会话**，互不抢同一沙箱  
6. 各自预览 HTML 原型、互相看产物、改自己那块  
7. 负责人做一次整合

他们总结的对比：

| 传统 | WorkBuddy |
| --- | --- |
| 每次开会重讲背景 | 项目记忆写一次，全员和 AI 共用 |
| 需求→设计→开发串行 | 多人并行，会话隔离 |
| 文件散落、版本乱 | 归档到项目目录 |
| 新人靠口传 | 进项目就继承上下文 |

可直接写成 Neo 的产品原则：

1. **共享的是项目，隔离的是 Run。** 不要让两个人的 Agent 写同一块未提交工作区。  
2. **项目记忆是一份文件，不是聊天。** 建议就是项目指令 + `AGENTS.md` + 资产库里的 `MEMORY.md`。  
3. **按可交付模块拆任务**，最后一次整合，不要按「产品 / 设计 / 开发」拆。  
4. **预览和产物必须留在项目里**，否则并行没有意义。

---

## 13. 和 Neo 的差距

| WorkBuddy | Neo 现在 | 缺口 |
| --- | --- | --- |
| 项目空间 | 没有。Run 只有 `orgId` / `userId` | 要 `projects` 表和 UI 入口 |
| 项目指令 / 项目 Skill | 工作区 `AGENTS.md`、`.neo/skills`，按仓库不按团队 | 项目级覆盖层 |
| 邀请 + 审批 | 单机账号登录 | 成员表、邀请链接、消息 |
| 任务分享 / 转交 / 多人跟进 | 登录者看自己的对话 | 授权、复制会话、跟进入队 |
| 计划看板 | 定时任务页（cron，不是看板） | 新实体，不要和 automations 混 |
| 项目资产 | Run artifacts、对象存储 | 项目级目录 + 回写 + 注入 |
| 项目动态 | 无 | 写 MySQL + 可选 notify |
| 自动化 | 已有，MySQL 持久化，整站一份 | 加上 `userId` / 可选 `projectId` |
| IM 入口 | Telegram / 微信公众号已能开 Run | 加上「开在某个项目里」 |
| 专家团 | `neo_subagent` | 够用，不做市场 |
| 连接器 | GitHub / 通知 webhook | 项目级绑定即可 |
| 在线协同编辑 / 发布站 | 无 | 明确不做 |

现网约束（跟的时候不要假装没有）：

- 应用机 4C/4G，**2 个 VM 槽**
- Agent loop 必须留在 VM，控制面只做编排
- 不要把 Cloud Agent 的 GitHub token 拷到轻量
- 定时任务、通知、登录这些已经在 `main`，项目协作要叠在上面，不要重写

---

## 14. 建议怎么跟：四期，由薄到厚

原则：**项目是文件夹，任务还是 Run。** 控制面加表和鉴权，worker 只多吃「项目指令 + 资产目录」。

### 第 0 期：先锁语义，不改大 UI

在合约里加 `Project` / `ProjectMember` / `ProjectInvite`，`Run` 增加可选 `projectId`。  
Web 先做「项目」顶栏（和「对话 / 定时任务」并列或作为对话的过滤器），能建项目、改指令、看到该项目下的 Run。  
一个人用也要成立：项目可以只有自己。

验收：建一个项目，写一段指令，在项目里开对话，worker 系统提示里看得到这段指令。

### 第 1 期：人能进来

- 邀请链接（默认管理员审批，可切免审）
- 角色：`owner` / `admin` / `member`
- 项目成员能看到项目内 Run 列表和只读 transcript
- 消息：站内一条 + 复用现有 notify

验收：第二个账号点链接进来，能看到第一个人在项目里开的对话，不能看到项目外的对话。

### 第 2 期：任务能交接

- 分享：项目成员打开同一 Run，跟进入现有队列
- 转交：打包 transcript 摘要 + artifacts +（可选）工作区快照，处理人换成对方；原作者只读
- 转交文案写明「对话记录会交给对方」

验收：A 跑完或跑到一半把任务交给 B，B 能接着说，不必重讲仓库和目标。

### 第 3 期：资产和看板

- 项目资产：上传、从 Run artifacts「保存到项目」、新 Run 注入 `/workspace/.neo/assets` 或 reference 列表
- 计划看板三列，卡片可「开对话」生成 Run
- 项目动态：邀请、转交、改指令、上传资产、卡片状态

验收：资产库放一份 `MEMORY.md`，两个人各自开 Run 都能读到；看板上点卡片能开出带项目指令的对话。

### 刻意后置

- 专家中心、技能市场
- 腾讯文档式人机双写、CSV/HTML 协同
- 公开分享整段会话
- 公共 OAuth 票据全员共用
- 桌面锁屏远程
- SSO / Credit / 网盘配额产品化

---

## 15. 建议数据模型和 API

下面是跟做用的建议形状，**不是** WorkBuddy 的私有协议。

### 15.1 表

`projects`

| 字段 | 说明 |
| --- | --- |
| `id` |  |
| `name` |  |
| `instruction` | 项目指令，可空 |
| `defaultRepoUrls` | JSON 数组 |
| `envId` | 可选，默认 Environment |
| `invitePolicy` | `approve` / `open` |
| `createdBy` |  |
| `createdAt` / `updatedAt` |  |

`project_members`：`projectId` + `userId` + `role`（`owner` / `admin` / `member`）+ `joinedAt`

`project_invites`：`token`、`projectId`、`createdBy`、`expiresAt`、`status`（`pending` / `accepted` / `rejected` / `revoked`）、`note`

`project_assets`：`projectId`、`path`、`objectKey`、`size`、`contentType`、`createdBy`、`updatedAt`、`source`（`upload` / `run`）、`runId?`

`project_todos`：`projectId`、`title`、`body`、`status`、`assigneeUserId`、`dueAt`、`runId`、`sort`

`project_events`：`projectId`、`actorUserId`、`kind`、`payload`、`createdAt`

`automations` 现表加：`userId`（必填）、`projectId`（可空）

`runs` 现表加：`projectId`（可空）、`assigneeUserId`（可空，默认创建者）

### 15.2 API（都挂 `/v1`，走现有登录）

```
GET    /v1/projects
POST   /v1/projects
GET    /v1/projects/:id
POST   /v1/projects/:id            # 改名称 / 指令 / 默认仓库
POST   /v1/projects/:id/invites
POST   /v1/invites/:token/accept
POST   /v1/projects/:id/members/:userId   # 改角色 / 踢人（admin）

GET    /v1/projects/:id/runs
POST   /v1/runs                    # body 增加 projectId，继承指令和默认仓库

POST   /v1/runs/:id/share          # 项目内授权
POST   /v1/runs/:id/transfer       # { toUserId, note }

GET    /v1/projects/:id/assets
POST   /v1/projects/:id/assets
POST   /v1/runs/:id/artifacts/:name/save-to-project

GET    /v1/projects/:id/todos
POST   /v1/projects/:id/todos
POST   /v1/projects/:id/todos/:todoId

GET    /v1/projects/:id/events
GET    /v1/inbox
```

Webhook（GitHub / Telegram / 微信）继续 **公开、不进 `/v1`**。若要开进某个项目，用项目里登记的 webhook secret 或绑定 chat，不要把它们改成要登录。

### 15.3 创建 Run 时多注入什么

控制面已经会把 `repoUrls`、environment、skills 落到工作区。项目协作只再加三样：

1. 系统提示最前面拼 `project.instruction`  
2. 若有资产，挂只读目录或文件清单  
3. `source` / 元数据带上 `projectId`，便于列表过滤和动态

不要把项目成员列表、邀请 token、别人的密码送进 VM。

### 15.4 Web 入口

现有顶栏是「对话 / 定时任务」。建议：

- 加「项目」：项目列表 → 详情（指令、成员、看板、资产、该项目对话）
- 对话页增加项目过滤器；在项目里点「新对话」自动带 `projectId`
- 定时任务以后按「我的 / 某项目」过滤，不要和看板混成一页

手机宽度已经按 44px 触控和 16px 输入做过。项目页继续卡片，不要回到挤在一行的设置表。

---

## 16. 风险

| 风险 | 为什么 | 怎么收 |
| --- | --- | --- |
| 两人同时跟进同一 Run | 双 `steer` 会把 pi 会话打乱 | 跟进必须进现有队列，界面显示「对方正在说」 |
| 转交把密钥拷走 | transcript / 工作区可能有 `.env` | 沿用打码；转交默认不拷 `.env` / `.neo/llm-upstream.env` |
| 项目资产撑爆 40G 盘 | 现网应用机磁盘小 | 资产走对象存储或库机盘，不进 VM 槽 ext4 |
| 槽位只有 2 个 | 多人并行会排队 | 产品文案写成排队；并行靠「各开各的 Run」，不要承诺无限沙箱 |
| 把办公套件整包搬过来 | 范围会把云端 Agent 做散 | 严格按第 14 节四期，后置名单不准偷偷做 |
| 自动化变成全员可见 | 官方刻意做成创建者私有 | 默认私有；要共享就用看板或项目动态，不要改官方语义 |

---

## 17. 建议的第一张产品切片（做完就能感觉像「项目」）

不要从看板或网盘开干。最小切片：

1. 能建项目、写项目指令  
2. 能邀请第二个账号进来  
3. 在项目里开对话，指令自动带上  
4. 对方看得到这次对话，并能排队跟进  
5. 能把这次对话转交给对方  

这五步已经覆盖 WorkBuddy 项目页里「共享上下文 + 三种任务协作」的骨架。资产库和看板是它的放大器，不是它的定义。

---

## 18. 资料索引

| 主题 | 链接 |
| --- | --- |
| 项目（官方定义最完整的一页） | https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project |
| 任务列表 / 状态 / 操作 | https://www.workbuddy.cn/docs/workbuddy/Task-Management |
| 创建任务 / 工作空间 / @引用 | https://www.workbuddy.cn/docs/workbuddy/Create-Task |
| 资料库总览 | https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library |
| 内容管理闭环 | https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Content-Management |
| 团队空间权限与审阅 | https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Collaboration |
| 连接器与公共/个人授权 | https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector |
| 专家 / 专家团 | https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Expert-Center |
| 技能市场 | https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market |
| 默认权限与沙箱 | https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Permission-Modes |
| 人机双写 | https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Knowledge-Base/Cowriting |
| 更新日志（Teams 从 5.0.0 起） | https://www.workbuddy.cn/docs/workbuddy/Changelog |
| 多人并行原型实战 | https://cloud.tencent.com/developer/article/2688477 |
| 企业微信接入 | https://www.workbuddy.cn/docs/workbuddy/Wecom-Guide |
| Neo 架构（对照用） | [architecture.md](./architecture.md) |
