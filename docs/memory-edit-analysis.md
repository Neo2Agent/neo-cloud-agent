# 记忆现在怎么工作，以及要不要让用户改

本文回答三件事：

1. 记忆现在到底是怎么跑的（写入、召回、管理三条链路，以及存在哪）。
2. 「只能增删、不能改」现在的实际代价是什么。
3. 该不该加编辑，前置条件是什么，落地要动哪几层。

选型背景见 [agent-memory-research.md](./agent-memory-research.md)，本文只谈已经落地的这套东西的机制和缺口。

结论先说：**应该支持编辑，而且它比「自动抽取」更该先做。** 底层 Mem0 2.0.19 的 `update()` 早就在，缺的只是侧车一条路由和上面两层的透传。但有一个必须先做的前置：现在 `DELETE /v1/memories/:id` **不校验这条记忆属不属于当前用户**，照抄这个形状加 `PATCH` 会把「猜到 UUID 就能删别人一条」升级成「猜到 UUID 就能往别人的系统提示里写任意文本」。

---

## 1. 现在的机制

### 1.1 存在哪

不在业务 MySQL 里。用户语义记忆全部在 Mem0 侧车（库机 `101.42.105.230:8888`，见 [.cursor/skills/tencent-lighthouse-db/SKILL.md](../.cursor/skills/tencent-lighthouse-db/SKILL.md)）：

| 层 | 东西 |
| --- | --- |
| HTTP | `mem0/app.py`，FastAPI，四条路由：`POST /memories`、`POST /search`、`GET /memories`、`DELETE /memories/{id}` |
| 引擎 | `mem0ai==2.0.19` |
| 向量 | pgvector，容器内 Postgres |
| Embedding | 容器内 fastembed `BAAI/bge-small-zh-v1.5`，512 维，本地算，**不走 llm-gateway** |
| 抽取用的 LLM | 只有 `infer=true` 时才打，指向 New API |

控制面侧 `packages/control-plane/src/memory/client.ts` 是一层薄代理：`listMemories` / `addMemory` / `searchMemories` / `deleteMemory`，加一个 `Mem0Error`。**控制面本地没有任何一份记忆索引**，MySQL 里没有 `user_memories` 表（`docs/workbuddy-feature-gap-2026-08.md` 里那张表是设想，没建）。没配 `MEM0_URL` / `MEM0_API_KEY` 时整个功能优雅降级成「未接上」。

### 1.2 写入

| 入口 | 路由 | `infer` | metadata |
| --- | --- | --- | --- |
| Web / Desk「记一条」 | `POST /v1/memories { text }` | `false` | 无 |
| Agent 工具 `neo_memory_add` | `POST /internal/runs/:id/memories { action: "add" }` | **恒为 `false`** | `{ source: "agent", runId }` |
| 直接打 API | `POST /v1/memories { text, infer: true }` | `true` | 无 |

关键点：**两个 UI 都不传 `infer`，Agent 路径写死 `false`**。也就是说现网里每一条记忆都是逐字存进去的原文，没有经过 Mem0 的事实抽取。

同样重要的是**没有自动抽取**。对话结束不会去 transcript 里捞事实，系统提示里还专门写死了这句话：

```ts
// packages/contracts/src/memory.ts
`... There is no automatic extraction at the end of a conversation; persist new facts with ${MEMORY_ADD_TOOL_NAME} ...`
```

这和 [agent-memory-research.md](./agent-memory-research.md) 第 1 期验收里的「Run IDLE 后异步抽取」对不上——那一步没做。

### 1.3 召回

```
createRun
  └─ writeRecalledMemory(run)          control-plane/src/memory/inject.ts
       searchMemories(userId, query = run.prompt, limit = 8)
       └─ 写 {workspace}/.neo/MEMORY.md

worker 开 session                        worker/src/session.ts
  └─ readUserMemory(cwd)
     composeSystemPrompt(base → boundary → expert → PROJECT.md → MEMORY.md)
     └─ appendUserMemory() 拼出 "# Recalled user memory"

对话进行中
  └─ neo_memory_search 按需查（默认 8 条）
```

三个值得记住的细节：

- boot 检索只用**第一条 prompt**当 query，之后不再刷新。对话跑偏到别的话题，系统提示里那 8 条不会变。
- `score` 在 `normalizeMemoryResults` 里解析了，但**没有任何地方用它**做排序或阈值过滤。召回什么就注入什么。
- `created_at` / `updated_at` 侧车返回了，`normalizeMemoryResults` 直接**丢掉**——`MemoryItem` 只留 `id` / `text` / `score` / `userId` / `metadata`。

### 1.4 管理

| 面 | 有什么 |
| --- | --- |
| Web `MemoriesPage.tsx` | 列表（limit 50）、客户端子串过滤、「记一条」、「删除」（带确认弹窗）、客户端分页 |
| Desk `MemoriesPage.tsx` | 同一套 API，`window.confirm` 删除，无分页 |
| Admin 台 | 无 |
| CLI | 无 |

所以对用户暴露的动词就三个：看、记、删。

---

## 2. 「只能删」现在的代价

### 2.1 删了重记不等价

| 丢的东西 | 说明 |
| --- | --- |
| `id` | 变了。任何按 id 引用的东西对不上 |
| `created_at` | 重置成现在 |
| `metadata.source` / `runId` | 唯一能区分「这条是 Agent 自己记的」和「我手写的」的信息，重记之后是手写的 |
| 原子性 | 两步。删成功、加失败 = 净损失一条 |
| 原文 | UI 上「记一条」的 `draft` 每次从空开始，列表卡片只显示 72 字截断。长条目连抄都不好抄，只能重打 |

### 2.2 语义后果才是重点

向量是按**整句**算的。设想 Agent 记下这么一条：

> 用户所有项目都用 pnpm，不要用 npm

实际情况是这个偏好只对某一个仓库成立。这条记忆现在会：命中无关 Run 的 boot 检索、占掉 8 条召回名额里的一格、以肯定语气进系统提示。用户唯一的补救是整条删掉——于是那条本来正确的偏好也一起消失了，下次还得重新教一遍。

这类「对一半」在这个系统里是**常态而不是例外**，因为：

1. 主要写入方是 LLM。`neo_memory_add` 的工具描述就是「Persist one concise user fact」，一句话概括最容易犯的错就是范围写太大、把项目级事实写成用户级。
2. `infer=false` 意味着 Mem0 端的 ADD / UPDATE / DELETE 自我纠正逻辑**被关掉了**。同一件事说两遍就是两条，说反了就是互相矛盾的两条。

合起来看，当前设计是：**我们关掉了引擎自带的自动更正，却也没给用户手动更正的入口。** 这是这套东西目前最实在的缺口，比「没有自动抽取」更靠前。

---

## 3. 底层支不支持

支持，而且是一等操作。`mem0ai==2.0.19`：

```python
Memory.update(memory_id, text=None, metadata=None, expiration_date=..., data=None)
```

行为（读 `mem0/memory/main.py` 的 `_update_memory`）：

| 方面 | 行为 |
| --- | --- |
| `created_at` | 保留 |
| `updated_at` | 写成现在 |
| `user_id` / `agent_id` / `run_id` / `actor_id` | **不可变**，`_strip_identity_keys` 会挡掉试图改身份的 metadata |
| 向量 | 重新 embed。本地 fastembed，一句话，**没有 LLM 调用，没有 gateway 成本** |
| 历史 | 写一条 `UPDATE` 事件，`Memory.history(id)` 可查前后值 |
| 实体索引 | 只在文本真的变了时才重建 |

另外 `Memory.get(memory_id)` 返回带 `user_id` 的单条记录，是一次向量库主键取行，不用 embedding——**这正好是补 owner 校验需要的东西**。

侧车 `app.py` 当初只按 add / search / list / delete 四条写，没往下暴露 `update` 和 `get`。缺口就在这一层。

---

## 4. 反对意见

| 顾虑 | 实情 |
| --- | --- |
| 编辑要重新 embed，贵 | fastembed 本地 512 维、一句话。比 `add` 还便宜，因为 `add` 在 `infer=true` 时要打一轮 LLM |
| 有删+增就够了 | 不等价，见 2.1；而且是两步非原子 |
| 该做的是自动抽取，不是编辑 | 顺序恰好反了。自动抽取会把「机器写的、可能不准的句子」放大一个量级。没有编辑入口的抽取，只会让记忆页变成一个不断删东西的地方。编辑是抽取的前置条件 |
| 会不会和 Agent 并发写打架 | 会，但 `update` 是按 id 覆盖，最后写入胜出。这个条数量级不值得上乐观锁 |
| 编辑后可能和另一条重复 | `infer=false` 本来就不去重，编辑不会让情况更糟。真要治是「按相似度阈值去重」，另一个话题 |
| Cursor / ChatGPT 也不一定能改 | [agent-memory-research.md](./agent-memory-research.md) 里我们自己写的目标形状就是「用户能看、能改、能删」。这一条是已经定过的 |

---

## 5. 前置：先补 owner 校验

`packages/control-plane/src/api/server.ts` 里的删除路由：

```ts
const memoryDelete = /^\/v1\/memories\/([^/]+)$/.exec(path);
if (memoryDelete && method === "DELETE") {
  if (actor.kind !== "user") { /* 401 */ }
  await deleteMemory(memoryDelete[1] ?? "");   // ← 只有 id，没有 userId
```

侧车的 `DELETE /memories/{memory_id}` 也只收 id，不收 `user_id`。所以从控制面到向量库，**全链路没有一个地方检查这条记忆属于谁**。

用一个临时探针跑过一遍（以 admin 登录，自己名下 0 条记忆，去删一个别人的 id）：

```
logged-in user's own memories: {"configured":true,"memories":[]}
DELETE /v1/memories/1f0c8a1e-0000-4000-8000-000000000abc -> 200 {"ok":true}

outbound calls the control plane made to Mem0:
  GET    http://mem0.probe/memories?user_id=828abd87-...&limit=50
  DELETE http://mem0.probe/memories/1f0c8a1e-0000-4000-8000-000000000abc

ownership lookup before delete? NO
```

UUID 猜不出来，所以现在的实际风险有限，属于「深度防御缺一层」而不是「在冒烟」。但**它决定了编辑的落地顺序**：写接口比删接口危险得多。删掉一条别人的记忆是拒绝服务；改掉一条别人的记忆，是往对方每一次新 Run 的系统提示里注入自己写的一句话，而对方在记忆页里看到的还是一条长得很正常的记录。

所以这一条不是「顺手做」的加分项，是加 `PATCH` 之前必须先落的地基。它本身也值得单独发一次，跟做不做编辑无关。

---

## 6. 真正的成本：侧车要单独重新部署

改动会落在四层：

| 层 | 改什么 | 走哪条发布路径 |
| --- | --- | --- |
| Mem0 侧车 | `app.py` 加 `PUT /memories/{id}` 和 `GET /memories/{id}` | **`mem0/deploy-mem0.sh`**，库机上 docker build + compose up |
| 控制面 client | `updateMemory()` / `getMemory()` | 常规 `deploy.sh` |
| 控制面路由 | `PATCH /v1/memories/:id`，删除/编辑前比对 `user_id` | 常规 `deploy.sh` |
| contracts | `MemoryItem` 加 `createdAt` / `updatedAt`，`normalizeMemoryResults` 别再丢 | 常规 `deploy.sh` |
| Web / Desk | 卡片加「编辑」，复用现有弹窗 | 常规 `deploy.sh` |

唯一不在常规发布路径上的就是第一行。由此产生一个硬约束：

> **侧车必须先上，控制面后上。**

反过来的话，`PATCH /v1/memories/:id` 打到旧侧车拿 405，`mem0Request` 会原样抛成 `Mem0Error("mem0_405", 405)`，用户在记忆页看到一个看不懂的报错。控制面现在没有任何 Mem0 能力探测（`/health` 只报 `configured` 和 `url`），没法优雅降级。

---

## 7. 建议的落地顺序

按依赖排，每一步都能单独发：

1. **侧车加 `GET /memories/{id}`**，控制面删除前比对 `user_id === actor.userId`，不匹配一律 404（不要 403，别泄漏「这个 id 存在」）。补 `app_test.py` 和 `memories.test.ts`。
2. **侧车加 `PUT /memories/{id}`** → `memory.update(memory_id, text=...)`。401 / 404 语义和现有路由保持一致。
3. **控制面 `PATCH /v1/memories/:id { text }`**，复用 `sendMem0Error`，走第 1 步的归属校验。
4. **contracts 保留 `created_at` / `updated_at`**。编辑功能要能显示「改过」才有意义，现在这两个字段在 `normalizeMemoryResults` 里被丢了。
5. **两个记忆页加「编辑」**。复用现有的 `CatalogModal` / `Modal`，`draft` 预填原文；`createOpen: boolean` 变成 `editing: { id: string } | "new" | null`。两个页面各约 20 行。

明确不做：

- 编辑历史 UI。`Memory.history(id)` 有数据，但产品没问，不要为了「有」而做。
- 项目级作用域（`scope=user|project`）。那是另一个设计，别混进来。
- 自动抽取。它应该排在编辑**后面**，理由见第 4 节。
- 把「编辑」实现成「删除 + 新增」的语法糖。那等于把 2.1 里列的所有损失包装成一个按钮，还多了一个可能中途失败的两步事务。

---

## 8. 一句话

该做。技术上是四层各加一条路由 / 一个按钮，Mem0 底下什么都齐了；真正的门槛是库机上的侧车要单独重新部署一次（并且必须先于控制面），以及必须顺带把现在全链路都缺的归属校验补上——写接口没有这层地基不能上。
