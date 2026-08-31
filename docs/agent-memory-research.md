# Agent 记忆调研：开源项目怎么接到 Neo

本文回答三件事：

1. Neo 现在有没有「记忆」，缺的是哪一层。
2. 2026 年主流开源记忆项目各自赌的是什么，和 Neo 冲不冲突。
3. 第一期该接谁、不该接谁、控制面 / worker / gateway 分别放哪。

结论先说：**不要换掉 pi，也不要把记忆引擎塞进 VM。** 跨 Run 的用户 / 项目事实适合做成控制面旁路服务。第一期优先 [Mem0](https://github.com/mem0ai/mem0)（Apache-2.0，add/search，REST + TypeScript SDK）。检索质量更在意、愿意多跑一个 Docker 时，备选 [Hindsight](https://github.com/vectorize-io/hindsight)（MIT，一条容器带嵌入式 Postgres）。[Letta](https://github.com/letta-ai/letta) 是整套 Agent 运行时，不能当记忆库。Zep 托管平台已经不能自托管；要图才接 [Graphiti](https://github.com/getzep/graphiti)，而且要新开图库。项目规则继续用已经落地的 `PROJECT.md` / `AGENTS.md`，不要用向量库代替人手写的指令。

星数、许可证、仓库活跃度以 **2026-08-25** 的 GitHub API 为准。

---

## 1. 我们现在缺什么

仓库里到处是 `memory`，但几乎都不是 Agent 长期记忆：

| 名字 | 实际是什么 |
| --- | --- |
| `createMemoryObjectStore` | 进程内对象存储，给测试用 |
| 限流 / 事件总线的 `memory` | Redis 没配时的进程内后备 |
| pi `SessionManager` JSONL | **单次 Run** 的工作记忆：可恢复、可 compaction、可跟进 |
| `GET /v1/runs/:id/transcript` | 给 UI / 审计的事件日志，不是检索库 |
| `.neo/PROJECT.md` | 项目指令落盘。控制面 `writeProjectMemory` 写出，worker `appendProjectInstruction` 拼进系统提示 |
| 工作区 `AGENTS.md` / `.neo/skills` | 仓库级规则和技能，跟这次 clone 走 |

[架构](./architecture.md) 已经写死：pi 管 session、compaction、steer / follow-up；控制面管子生命周期、鉴权、环境和 SCM。**跨对话记住「这个用户喜欢 pnpm」「这个项目上次决定不用 worktree」** 不在 pi 职责里，现在也没有。

[WorkBuddy 协作调研](./workbuddy-project-collaboration.md) 已经把产品语义拆开了：

- **项目记忆是一份文件，不是聊天。** 建议就是项目指令 + `AGENTS.md` + 资产库 `MEMORY.md`。这一层已经开始落地（`Project.instruction` → `.neo/PROJECT.md`）。
- **个人记忆** 当时写的是「拼进上下文」，还没有表、没有抽取、没有跨 Run 检索。

所以缺口不是「再做一个 compaction」，而是下面三层里的后两层：

```
工作记忆     当前 Run 的 JSONL + compaction          ← 已有，别动
文件记忆     人手写的项目 / 仓库规则                  ← 已有雏形，继续加厚
语义记忆     从对话抽出来的、可检索、可改、可删的事实   ← 缺，本文只谈这一层
```

编码 Agent 真正要的语义记忆也很窄，先不要按「数字生命」去买图数据库：

| 类型 | 例子 | Neo 要不要 |
| --- | --- | --- |
| 用户偏好 | 用 pnpm、中文回复、不要 force push | 要。跨 Run、按 `userId` |
| 项目事实 | 这个仓库默认 DeepSeek Flash；PR 必须带测试 | 要。按 `projectId`，和 `PROJECT.md` 互补 |
| 情节摘要 | 上周那次失败是因为槽满排队 | 可后做。transcript 已经在，先别建第二份日志 |
| 时序知识图 | 「三月还在用 deepseek-chat，五月改成 v4-flash」 | 产品没问之前不做 |
| 代码库 RAG | 把整个 monorepo 打成向量 | 不是记忆。pi 已经有 `read` / `grep` |

对标 Cursor：Memories 是服务端抽出的短事实，用户能看、能改、能删；Rules / `AGENTS.md` 仍是文件。Neo 应该抄这个产品形状，而不是抄某一家的论文分数。

---

## 2. 一条必须先锁死的接入原则

**记忆仓库放在控制面信任域，不放在 VM 磁盘，也不替换 pi。**

现网约束（跟的时候不要假装没有）：

- Agent loop 必须留在 VM。控制面只编排。
- Worker 不可信：没有 Provider Key，出站走 egress，空闲会卸槽。记忆不能只写在 `/var/neo/sessions`。
- 抽取和 embedding 的 LLM 必须走 `llm-gateway`，不能让记忆引擎自己拿一份 DeepSeek / OpenAI Key 打公网。
- 现网是 **MySQL 8.4 + Redis 7**（库机 `101.42.105.230`），应用机 4C/4G、**2 个 VM 槽**。没有 Postgres / pgvector，没有 Qdrant，没有 Neo4j。
- 已经有 HTTP MCP 控制面代理（`neo_mcp_list` / `neo_mcp_call`）。密钥不进 worker。
- TypeScript monorepo。能 HTTP / 官方 TS SDK 就不要在 worker 里嵌 Python。

推荐拓扑：

```
transcript / 用户改记忆
        │
        ▼
  control-plane  ──search / add──►  记忆旁路（Mem0 或 Hindsight）
        │                                 │
        │                                 ▼
        │                           llm-gateway（抽取 + embedding）
        ▼
  启动时注入 systemPrompt / PROJECT.md
  可选：neo_memory_search / neo_memory_add → /internal
        │
        ▼
     worker + pi     （无密钥，不持久化语义记忆）
```

三件不要做：

1. 用 Letta / MemOS 插件换掉 `createAgentSession`。
2. 在 ephemeral VM 里跑 OpenMemory / MemOS local SQLite，卸槽就丢。
3. 把 transcript 归档当成可检索记忆。那是审计副本。

---

## 3. 项目怎么比

记忆项目不是功能清单差几个 API，是对「记住」的三种不相容赌注：

| 赌注 | 代表 | 模型 |
| --- | --- | --- |
| 抽取式事实层 | Mem0、Memobase | 对话进、LLM 抽事实、向量检索、ADD/UPDATE/DELETE |
| 时序知识图 | Graphiti（Zep 的开源引擎）、Cognee | 实体和边带有效期，问的是「当时什么为真」 |
| 状态 Agent 运行时 | Letta（原 MemGPT）、MemOS 插件 | Agent 自己改 core memory、自己决定换页 |

Neo 已经有运行时（pi）和文件规则（`PROJECT.md`）。缺的是第一类：**可插拔的事实层**。第二类以后有「这个仓库的事实会过期」再加。第三类和「内核是 pi」冲突。

---

## 4. 候选（按适不适合 Neo 排，不是按星数）

### 4.1 第一期首选：Mem0

[mem0ai/mem0](https://github.com/mem0ai/mem0) · **64.0k** · Apache-2.0 · 2026-08-25 仍在推

抽事实、做 CRUD、按 `user_id` / `agent_id` / `run_id` 过滤。Python 库是本体；有 `npm install mem0ai` 的 TypeScript SDK；自托管是 FastAPI + Dashboard + 每用户 API Key。默认向量库是 **Postgres + pgvector**（库模式也可以 Qdrant）。图是可选项，要 Neo4j / Memgraph。另有 [OpenMemory](https://github.com/mem0ai/mem0/tree/main/openmemory)：本机 MCP，给 Cursor / Claude Desktop 用，不是多租户云服务。

**为什么适合 Neo**

- 不抢 Agent loop。控制面 `add()` / `search()` 就能接到现有 Run。
- 作用域和现有模型对齐：`user_id` → 个人记忆，`agent_id` 或 metadata → `projectId`，`run_id` → 本次对话。
- REST 够用，worker 不必 import Python。
- OpenMemory / 官方 MCP 以后可以挂到已经有的 `neo_mcp_*`，但第一期不要靠 MCP 当权威存储。
- 论文和第三方评测都把它放在「延迟低、token 少」一侧（LoCoMo 上大约 1.8k tokens / 对话量级，对比全上下文和重图方案）。分数别太当回事，各家裁判模型不一致；形状是对的。

**坑**

- 抽取默认打 OpenAI。必须改成 OpenAI-compatible，指向 `llm-gateway`。Gateway 现在没有 embedding 路由，接之前要补一个 embed 模型（DeepSeek / 本地 bge / gateway 再转上游）。
- 现网 MySQL **不能**当向量库。Mem0 自托管默认 Postgres。应用机再叠一套 Postgres + 记忆 API，或单独起 Qdrant。不要把向量塞进现在的业务 MySQL。
- 开源版和 Platform 不是同一功能集。高级仪表盘、部分图能力在云上。自托管以开源 API 为准。
- TypeScript OSS 和 Python 并不完全同构。生产路径优先 **自托管 HTTP**，控制面用 fetch，不要把 `mem0ai/oss` 嵌进 worker。
- OpenMemory 是单机隐私向。多租户云 Agent 用控制面当唯一写入口。

**建议接法**

1. 应用机（或库机旁）`docker compose` 起 Mem0 server。向量用它自带的 Postgres，或一只小 Qdrant。
2. 控制面加薄封装：`searchMemories({ userId, projectId, query })` / `addMemories(...)`。Run JWT 不能直打 Mem0。
3. `createRun` / worker boot：按 prompt 检索，拼进系统提示，和 `appendProjectInstruction` 并列。
4. Run 进 IDLE 或 `agent_end`：异步丢一段打码后的 transcript 去抽取。不要在用户打字的热路径上抽。
5. `neo_memory_search` / `neo_memory_add` 和设置抽屉里的记忆列表已落地。用户必须能删。

### 4.2 质量备选：Hindsight

[vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) · **21.1k** · MIT · 2025-10 开源，2026-08-25 仍活跃

API 是 `retain` / `recall` / `reflect`。检索同时走语义、BM25、图遍历、时间过滤，再交叉编码器重排。事实会收成 observation，带证据，矛盾时更新而不是覆盖。官方说 LongMemEval 上高于 Mem0 / Zep / SuperMemory；论文是 arXiv:2512.12818，裁判模型和各家自己报的数对不齐，只能当「检索更重、更慢、可能更准」。

部署是一条 Docker：嵌入式 Postgres（pg0），API + MCP 在 `:8888`。TS 客户端 `@vectorize-io/hindsight-client`。LLM 用环境变量，可指到 OpenAI-compatible。bank 的概念能映射成 `user:{id}` / `project:{id}`。

**什么时候选它而不是 Mem0**

- 要把「跨很多 Run 还能答对」做成产品差异，而不是先把个人偏好接上。
- 能接受再跑一个容器，以及 `retain` 异步（刚写入立刻 `recall` 可能空）。
- 想直接挂 HTTP MCP。Neo 已经有控制面 MCP 代理。

**什么时候不要先选**

- 社区和集成面比 Mem0 小（LangChain / CrewAI 那些样板 Mem0 更多）。
- 嵌入式 Postgres 在 4C/4G 应用机上要盯内存；和生产 MySQL 是两套库。
- `reflect` 会再吃一轮 LLM。第一期只用 `retain` + `recall`，别把推理也交给它。

Hindsight 是 **P1.5**：Mem0 抽事实不够准、或 MCP 一条链路更省事时再换，接口仍停在控制面的 search/add，不要让 worker 锁死某一家 SDK。

### 4.3 以后才需要：Graphiti（不要接 Zep 托管）

[getzep/graphiti](https://github.com/getzep/graphiti) · **30.3k** · Apache-2.0

双时态图：每条事实有 `valid_at` / `invalid_at`，新信息让旧边失效，不删历史。后端是 Neo4j 5.26+、FalkorDB、Neptune 等。Python 为主，有 MCP server。Zep 产品 2026 年中已把 Community Edition 收掉，`getzep/zep` 只剩示例；**要自托管就跑 Graphiti，不是 Zep**。

适合「这个项目的默认模型换过两次，Agent 还要知道五月之前那套」。不适合第一期「记住我用 pnpm」。代价是新图库、构图贵、写入后图要消化一会儿才能搜到（第三方测过：Mem0 论文里 Zep 单对话 token 可到几十万量级；刚 ingest 完立刻检索会空）。应用机 4G 不该再叠 Neo4j。真要做，单独扩库机，MCP 走现有 `neo_mcp_*`，Python 别进 worker。

### 4.4 明确不接：Letta

[letta-ai/letta](https://github.com/letta-ai/letta) · **24.4k** · Apache-2.0 · 原 MemGPT

这是有记忆层级的 **Agent 操作系统**：core memory 常驻上下文，archival 按需换入，Agent 用工具自己改自己。和「内核是 pi、loop 在 VM」对着干。接 Letta = 再写一套编排、事件、跟进、工具。自托管没问题，但那是换内核，不是加记忆。

### 4.5 先看着：MemOS

[MemTensor/MemOS](https://github.com/MemTensor/MemOS) · **11.0k** · Apache-2.0

中国团队，宣传 DeepSeek Harness / OpenClaw / Hermes 插件，本地 SQLite + FTS5 + 向量，还有 Cloud 插件。TypeScript 仓库比重大。完整自托管要 Neo4j + Qdrant。

Local plugin 的钩子是别人的运行时（`before_agent_start` / `agent_end`），数据落在 `~/.openclaw/memos-plugin/` 这类本机目录。Neo 的 worker 是短命槽，这个形状接不上。Cloud API 能当旁路，但生态绑的是 OpenClaw / DSH，不是 pi。DeepSeek 友好是加分，等他们有稳定 HTTP 和多租户隔离再评一次，现在不要把 plugin 打进 worker 镜像。

### 4.6 文档库，不是对话记忆：Cognee

[topoteretes/cognee](https://github.com/topoteretes/cognee) · **30.3k** · Apache-2.0

`add → cognify → search`：文档进，图 + 向量出。适合项目资产库、规范、纪要。和「用户偏好」不是同一条产品。资产目录真要语义检索时再看，别当个人记忆。

### 4.7 其余

| 项目 | 结论 |
| --- | --- |
| [LangMem](https://github.com/langchain-ai/langmem) | MIT，但是 LangGraph 的记忆层。Neo 不用 LangGraph。 |
| SuperMemory | 闭源，自托管要企业合同。密钥和对话不能出信任域。 |
| [Memobase](https://github.com/memodb-io/memobase) | 2.9k，Apache-2.0，用户画像 + FastAPI/Postgres/Redis，有 Node SDK。更像陪伴/客服画像。2026-01 之后几乎没推。备忘，不当第一依赖。 |
| MemoryOS / Memvid / 各种 MCP 备忘录 | 实验或单机。云多租户不够。 |

---

## 5. 和 Neo 现网怎么对齐

| 约束 | Mem0 | Hindsight | Graphiti | Letta | MemOS local |
| --- | --- | --- | --- | --- | --- |
| 不替换 pi | 是 | 是 | 是 | **否** | 钩子绑别人的 runtime |
| 记忆活过卸槽 | 旁路服务可以 | 旁路服务可以 | 旁路服务可以 | 自己管 session | SQLite 在 VM 里会丢 |
| 抽取走 gateway | 要改默认 OpenAI | 环境变量可指兼容接口 | 要配兼容 LLM | 整套自己推 LLM | 插件自己配 Key，危险 |
| TS / HTTP | REST + TS SDK | HTTP + 官方 TS | Python + MCP | 自己的 Agent API | 插件，不是通用 HTTP |
| 现网 MySQL/Redis | 不够，要 Postgres 或 Qdrant | 自带嵌入式 PG | 要 Neo4j/FalkorDB | 另起一套 | 本机 SQLite |
| 4C/4G + 2 槽 | 一只小旁路还行 | 一只容器还行 | 图库太重 | 太重 | 不该进槽 |
| 已有 MCP 代理 | OpenMemory 可挂，第一期不必 | 原生 HTTP MCP | 官方 MCP | 不靠这个 | 不是这条路 |
| 多租户隔离 | `user_id` + 控制面鉴权 | bank + 控制面鉴权 | group_id，要自己包 | Letta 用户 ≠ Neo 用户 | 单机 |

现网两台轻量不要把记忆图库和业务 MySQL 绑死。记忆旁路和 New API 一样：**独立进程，HTTP 调用**；不要 vendoring 进本仓库。

---

## 5.1 底层用什么库，要不要接 RAG

两句先说清：

1. **语义记忆引擎自带（或另起）向量库，不能复用现网业务 MySQL。** 文件记忆（第 0 期）只用现在的 MySQL / 落盘文件，不新开库。
2. **不必再接一套文档 RAG 模型。** Mem0 / Hindsight 要的是「抽事实的聊天模型 + 向量 embedding」，不是把仓库打成知识库。代码检索继续用 pi 的 `read` / `grep`。

### 各家默认存哪

| 方案 | 事实 / 元数据 | 向量检索 | 图（可选） | 现网能不能复用 |
| --- | --- | --- | --- | --- |
| 第 0 期文件记忆 | 现网 MySQL 字段，或 `MEMORY.md` / `PROJECT.md` | 无。条数少就整段注入 | 无 | **能。零新库** |
| Mem0 自托管 server | 它 compose 里的 **Postgres** | 同一套 Postgres 的 **pgvector** | 可选 **Neo4j** | 不能塞进 `101.42.105.230` 那台业务 MySQL。另起 Postgres，或向量改 **Qdrant** |
| Mem0 当库 embed | 默认 SQLite history | Python 默认本地 Qdrant（`/tmp/qdrant`）；也可 pgvector / Redis / Milvus / Chroma 等 | 可选 Neo4j / Memgraph | 只适合本机试，不适合多租户云 |
| Hindsight | 容器内嵌入式 **Postgres（pg0）**，也可外挂 Postgres | 同一套 PG，不另开 Qdrant | 内置实体图，不另开 Neo4j | 和生产 MySQL 是两套 |
| Graphiti | **Neo4j / FalkorDB / Neptune** | 图库 + 全文（FalkorDB 可走 Redis 口） | 这就是主库 | 现网没有，要新开 |
| MemOS local | 本机 **SQLite** | SQLite 里的向量 + FTS5 | 完整自托管才要 Neo4j+Qdrant | VM 卸槽会丢，云上不要 |

Mem0 开源还声称能接 Redis、Elasticsearch、Weaviate、Pinecone、Azure MySQL 等。Azure MySQL 那条在 TypeScript 里是应用层算余弦，**不是** MySQL 原生向量索引，现网 8.4 不要走这条省事。

第 1 期落地时推荐二选一，都放控制面旁边，别进 VM：

- Mem0 官方 compose：一只 Postgres（带 pgvector），需要图再加 Neo4j。
- 现网只想多一个小进程：一只 **Qdrant** 给 Mem0 当 `vector_store`，元数据仍由控制面 MySQL 管（见第 7 节 `MemoryItem`）。

### 和 RAG 差在哪

RAG 通常是：**稳定文档库 → embedding → 检索片段 → 塞进提示让模型答。** 仓库问答、说明书属于这一类。Neo 现在不缺这个：worker 已经在仓库旁边 `read` / `grep`。

Agent 记忆是另一件事：

```
对话 / 用户手写
    →（可选）聊天模型抽出短事实     ← 复用 llm-gateway，不是新 RAG 模型
    → embedding 写成向量             ← 要 embedding 模型，不是 chat 模型
    → 向量库检索最相关的几条
    → 注入系统提示 / 工具返回
```

所以：

| 要不要 | 说明 |
| --- | --- |
| 单独的「RAG 模型」或仓库向量库 | **不要。** 那是文档问答，和记忆叠会抢上下文。 |
| embedding 模型 | **第 1 期要。** Mem0 / Hindsight 的 `search` / `recall` 靠向量。走 gateway，可用上游 embedding 或本机 bge；**换模型要重建向量，维度必须和表一致。** |
| 聊天模型做抽取 | Mem0 默认 `add()` 会再打一轮 LLM 做 ADD/UPDATE/DELETE。可以复用现有 DeepSeek。用户手写记忆（第 0 期，或设置页 POST）可以不抽。 |
| 重排模型 reranker | 可选。Mem0 默认关。Hindsight 自带交叉编码器，算在它容器里。 |
| 第 0 期 | **模型和向量库都不要。** 偏好就几十条，MySQL 读出来拼进 prompt。 |

个人 / 项目偏好条数少时，向量库的收益很小。先文件记忆；事实变多、要按这句话检索时，再上 embedding + pgvector/Qdrant。不要为了「接 RAG」把整个 monorepo 打进记忆引擎。

---

## 6. 建议怎么跟：三期，由薄到厚

原则：**文件规则继续手写；语义记忆是控制面旁路；worker 只多吃一段注入，或以后多两个工具。**

### 第 0 期：先把「文件记忆」做满，不接开源引擎

个人偏好写成控制面字段或用户级 `MEMORY.md`，boot 时和 `PROJECT.md` 一起注入。项目资产里的 `MEMORY.md` 按 WorkBuddy 第 3 期做。用户能看见、能改、能清空。

验收：设置里写「用 pnpm，不要 worktree」，新开一条不带旧 session 的 Run，系统提示里看得到。

这一期就能覆盖很多「记忆」话术，而且零新基础设施。

### 第 1 期：Mem0 旁路（推荐默认）

独立进程 + 控制面封装 + 启动检索 + IDLE 后异步抽取。Gateway 补 embedding。记忆按 `userId` / `projectId` 隔离，写进 transcript 的工具输出继续打码，抽取前再打一遍。

验收：

1. 用户在 Run A 说「以后都用中文、包管理器用 pnpm」。
2. Run A IDLE 后能在设置页看到两条记忆，能删其中一条。
3. 同用户新开 Run B（新 session），模型不再问包管理器，删掉的那条不再出现。
4. 另一个账号的 Run 检索不到这些记忆。
5. Worker 环境变量和磁盘上没有 Mem0 / Provider Key。

备选：同一套控制面接口后面换 Hindsight。`search` / `add` 不要泄漏 Mem0 的 collection 名。

### 第 2 期：工具 + 管理面

`neo_memory_search` / `neo_memory_add` 已走 `POST /internal/runs/:id/memories`，和 `neo_mcp_*` 一样密钥不上 VM。对话页设置抽屉可以看/记/删。管理台按用户审计抽取失败仍未做。不要做「专家市场」。

### 刻意后置

- Letta / 任何「换掉 pi」的记忆 OS
- Graphiti / Neo4j，除非产品明确要时序事实
- Cognee 当个人记忆
- SuperMemory / Zep 托管（对话出域）
- 在 VM 里跑 OpenMemory / MemOS local
- 用记忆引擎做代码库 RAG

---

## 7. 建议数据模型和 API（第 1 期）

控制面自己留一份可编辑索引，向量库只当检索后端。这样换 Mem0 / Hindsight 不用迁用户表。

```
MemoryItem
  id, userId, projectId?, runId?
  kind: "user" | "project"
  text
  source: "manual" | "extracted"
  status: "active" | "deleted"
  createdAt, updatedAt
```

对外（和现有 `/v1` 一样走用户 session）：

```
GET    /v1/memories?scope=user|project&projectId=
POST   /v1/memories          { text, projectId? }
DELETE /v1/memories/:id
```

对内：

```
POST   /internal/runs/:id/memories/search   worker 可选工具
POST   /internal/runs/:id/memories/add      worker 可选工具
```

Boot 注入伪代码（接在现有 `appendProjectInstruction` 旁边，不要新开一套 prompt 框架）：

```ts
const recalled = await searchMemories({ userId, projectId, query: prompt, limit: 12 });
systemPrompt = appendMemoryBlock(systemPrompt, recalled);
```

抽取放在 `agent_end` / IDLE，用打码后的用户话 + 最终答复，不要把整段工具日志丢进 Mem0。

---

## 8. 和现有文档的关系

| 文档 | 关系 |
| --- | --- |
| [architecture.md](./architecture.md) | 内核仍是 pi。本文只补「pi 不管」那一列里的长期记忆。 |
| [workbuddy-project-collaboration.md](./workbuddy-project-collaboration.md) | 项目记忆继续是文件；个人记忆从「拼进上下文」落实成第 0 / 第 1 期。 |
| [admin-platform-research.md](./admin-platform-research.md) | 记忆旁路和 New API 一样：独立进程。不要并进 `llm-gateway`，也不要并进 admin-api。 |

---

## 9. 一句话对照

| 你想要的 | 接 |
| --- | --- |
| 跨 Run 记住用户和项目事实，最少新概念 | **Mem0 自托管 + 控制面封装** |
| 检索更重、一条 Docker、以后挂 MCP | **Hindsight**（同一套控制面接口） |
| 人手写的团队规矩 | **已经在做的 `PROJECT.md` / `AGENTS.md`** |
| 「三月那会儿默认模型是什么」 | 以后 **Graphiti**，现在不要 |
| 换一个带记忆的 Agent | **不要。** 那是 Letta，不是 Neo |
