# 记忆编辑：技术方案

配套分析见 [memory-edit-analysis.md](./memory-edit-analysis.md)。规约按《阿里巴巴 Java 开发手册（嵩山版）》七维意图等价落到 TypeScript / Python，只落约定，不引入 eslint / prettier。

基线：手机云端面对齐已在 [PR #138](https://github.com/Neo2Agent/neo-cloud-agent/pull/138) 合上（源 PR [#129](https://github.com/Neo2Agent/neo-cloud-agent/pull/129)）。合入后 Web / Desk / mobile 都有同一套看 / 记 / 删。本文只谈怎么加「改」。

一句话范围：给用户记忆加原地编辑，把「改」和「删」都补上归属校验，并把已经核实的合规缺口收在同一条产品路径里。不做自动抽取、不做项目级作用域、不做编辑历史 UI、不给 Agent 编辑工具、不引入新工具链。

---

## 1. 现状与目标

```
写入: Web / Desk / mobile「记一条」或 neo_memory_add
    → control-plane /v1/memories 或 /internal/runs/:id/memories
    → Mem0 侧车 POST /memories（infer=false）→ pgvector

召回: createRun → search 8 条 → workspace/.neo/MEMORY.md
    → worker 拼进系统提示
    对话中还可 neo_memory_search
```

已核对的事实：

- 存储在 Mem0 侧车，不在业务 MySQL。控制面无本地索引。
- 两条写入都是 `infer=false`，逐字存原文。没有对话结束抽取。
- 用户动词只有看 / 记 / 删。底层 `Memory.update()` 已存在，侧车没暴露。
- `DELETE /v1/memories/:id` 全链路不校验归属：登录用户名下 0 条，删别人的 id 仍 200。
- `GET /v1/memories?limit=abc` 会拼出 `?limit=NaN`，侧车 422，界面显示 `mem0_422`。
- 公开路由与内部路由各写一份校验；Web 的 `MemoryRow` 是 `MemoryItem` 的窄化副本。

目标验收：用户能改一条记忆且 id / `createdAt` / `source` 不变；别人的 id 改或删都是 404；非法 `limit` 不再冒烟；错误提示是中文而不是 `mem0_*`。

---

## 2. 规约怎么落到本仓库

手册是 Java 视角。只列本功能会碰到的强制 / 推荐项。集合处理、线程池、Javadoc、MySQL 整章不适用，不硬套。

- 命名：lowerCamelCase 函数、PascalCase 类型。Python 前导下划线是语言级私有，与现有 `_env` / `_jsonable` 一致。归属检查叫 `_require_owned_memory`，不把状态码写进函数名。
- 常量：不允许未定义字面量直接出现。按功能放 [`packages/contracts/src/memory.ts`](../packages/contracts/src/memory.ts)，照现有 `MEMORY_ADD_TOOL_NAME` 推广，不建全局常量类。
- 日期时间：比较用 epoch，不用字符串相等。
- 控制语句：新代码卫语句，嵌套不超过 3 层。
- 注释：TSDoc 只写契约（入参、返回、抛出、不变量），不写叙述。
- 前后端：协议 / 方法 / 状态码 / 响应体写死；空列表返回 `[]`；错误含状态码 + `code` + 排查信息 + 用户提示；JSON 键 lowerCamelCase。
- 异常日志：禁止用异常做流程控制；禁止吞掉原始错误；禁止把用户记忆正文打进日志。
- 单元测试：AIR + BCDE。增量代码必须有测试。覆盖率自检，不设 CI 数字门禁。
- 安全：不信任客户端入参；权限校验；入参有效性验证；敏感数据脱敏。
- 工程结构：Controller 不直连防腐层。
- 设计：避免过度设计（不拆 DO/DTO/VO）；有现成搜索接口就要接上。

---

## 3. 原样复用 vs 必须改

原样复用（新代码必须继承）：

- 内部路由用 `run.userId`，忽略客户端 `userId`。[`memories.test.ts`](../packages/control-plane/src/api/memories.test.ts) 已锁。
- Key 只在控制面，`X-API-Key` 不下 VM；侧车 `hmac.compare_digest`。
- `mem0Request` 统一超时；`Mem0Error` 带 HTTP 状态。
- `normalizeMemoryResults` 把 snake_case 关在防腐层。
- `memoryHint` 集中用户文案。
- `writeRecalledMemory` 失败只 warn、不阻塞 Run、日志不含正文。
- `setMem0FetchForTests` 作为单测注入点。
- `tsconfig` `strict`。

必须改：

- 无编辑、无归属校验。
- 路由直连 client，公开 / 内部各写一份校验。
- 错误体只有 `error`，前端原样显示 `mem0_405`。
- 正文无长度上限；`limit` 钳制放错层且透传 `NaN`。
- 魔法数字 / 字符串多处各写一份，Desk 与 Web 截断行为已不一致。
- `/health` 无鉴权回传 `mem0.url`；侧车 `/health` 回传 `llm_base`。
- 侧车 `infer` 默认 `True`；`AddBody` 同时收 `messages` 和 `text`。
- `except TypeError` 做版本分支（`mem0ai==2.0.19` 已 pin，死代码）。
- `Mem0Error` 不带 `cause`；worker 裸 `catch` 吞掉非 ENOENT。
- `metadata` 是 `Record<string, unknown>`；搜索接口存在但 UI 用客户端过滤。
- Web 的 `MemoryRow` 与重复单测。

---

## 4. 设计决策

**归属校验放侧车。** `Memory.get(id)` 是主键取行，不用 embedding。离数据最近，未来任何调用方都受保护。控制面不做二次校验。不匹配与不存在都返回 404，不泄漏 id 存在性。

**编辑是原地 `update`，不是删 + 增。** 保留 `created_at`、身份字段、`UPDATE` history，一次重新 embed。

**侧车一次发完。** `deploy-mem0.sh` 最贵，`PUT` + 归属 + `max_length` + `infer` 默认改 `False` 一起上。`DELETE` 的 `user_id` 本轮可选，老控制面不带也能删，零停机。

**公开 API 用 `PATCH`。** 与 `/v1/me`、`/v1/experts/:id` 一致。侧车对内用 `PUT`（整段替换）。

**乐观锁。** `PATCH` 带可选 `updatedAt`。侧车 `_require_owned_memory` 已取过记录，顺带比对，不一致 409。不传则 last-write-wins，仅供脚本。

**`limit` 在 Service 归一化，不在 client 钳制。** 非法值回退默认（展示参数，不打断老客户端）；越界钳制。`client.ts` 参数收窄为已归一化的 `number`。

**Agent 不给编辑工具。** `neo_memory_search` 正文不返回 id，模型改自己写过的记忆收益不明。

---

## 5. 分层与数据流

```
/v1/memories ──鉴权后只传 actor.userId──► memory/service.ts
/internal/runs/:id/memories ──只传 run.userId──► memory/service.ts
        │
        ├─ normalizeLimit / 正文校验 / 乐观锁
        ▼
 memory/client.ts（防腐，snake_case 不外泄）
        ▼
 侧车 _require_owned_memory → mem0ai Memory
```

新增 [`packages/control-plane/src/memory/service.ts`](../packages/control-plane/src/memory/service.ts)：

```ts
export class MemoryServiceError extends Error {
  constructor(
    readonly code: MemoryErrorCode,
    readonly status: number,
    readonly userTip: string,
    readonly detail?: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

export function listUserMemories(userId: string, limitRaw?: string | number): Promise<MemoryItem[]>;
export function addUserMemory(userId: string, text: string, metadata?: MemoryMetadata): Promise<MemoryItem[]>;
export function searchUserMemories(userId: string, query: string, limitRaw?: string | number): Promise<MemoryItem[]>;
export function updateUserMemory(input: {
  userId: string;
  id: string;
  text: string;
  updatedAt?: string;
}): Promise<MemoryItem>;
export function removeUserMemory(userId: string, id: string): Promise<void>;
```

路由只做：未登录 401、读 body、调 Service、`sendMemoryError`。内部路由复用同一组函数。

---

## 6. API 契约

### 6.1 侧车

```
PUT    /memories/{id}
       body: { user_id, text, updated_at? }     text 1..MEMORY_TEXT_MAX_LENGTH
       200 { results: [ MemoryItem ] }
       401 / 404 / 409 / 422

DELETE /memories/{id}?user_id=                  user_id 可选；给了就强制
       200 / 401 / 404
```

`Memory.update()` 只返回 `{'message': ...}`，所以 update 后再 `get` 一次，包成 `{ results: [...] }` 给现成的 `normalizeMemoryResults`。原型已验证：8 项契约测试全过，返回体能被当前 `normalizeMemoryResults` 吃下（缺的只是时间戳）。

`AddBody.infer` 默认改为 `False`。控制面只发 `text`。`search` / `list` 删掉 `except TypeError` 分支。

侧车 `/health` 去掉 `llm_base`，保留 `ok` / `service` / `embedder` / `embedding_dims` / `vector`。

### 6.2 控制面

```
GET    /v1/memories?limit=
POST   /v1/memories                 { text }
POST   /v1/memories/search          { query, limit? }
PATCH  /v1/memories/:id             { text, updatedAt? }     新增
DELETE /v1/memories/:id             现改为带 actor.userId
```

成功：`200/201`，列表仍 `{ configured, memories }`，编辑 `{ memory }`。

失败（仅记忆路由试点）：

```ts
{ error: string; code: MemoryErrorCode; message: string; detail?: string }
```

`error` **继续是中文**。旧 Desk / 旧 mobile 包只读这个字段；改成错误码会直接画在页面上。`code` 给新客户端和排查；`message` 与 `error` 同文案。新客户端读 `message ?? error`。

| code | HTTP | 类 | message |
| --- | --- | --- | --- |
| `MEMORY_LOGIN_REQUIRED` | 401 | A | 请先登录 |
| `MEMORY_TEXT_REQUIRED` | 400 | A | 请填写记忆内容 |
| `MEMORY_TEXT_TOO_LONG` | 400 | A | 单条记忆不能超过 500 字 |
| `MEMORY_QUERY_REQUIRED` | 400 | A | 请填写要搜索的内容 |
| `MEMORY_NOT_FOUND` | 404 | A | 记忆不存在 |
| `MEMORY_VERSION_CONFLICT` | 409 | A | 这条记忆刚被改过，请刷新后再试 |
| `MEMORY_STORE_UNAVAILABLE` | 503 | C | 记忆还没接上 |
| `MEMORY_STORE_FAILED` | 502 | C | 记忆服务暂时不可用 |

`GET /health` 的 `mem0` 只保留 `{ configured }`，去掉 `url`。运维看 URL 用主机上的 `MEM0_URL`。

限流：`PATCH` 已走 `api` + `write`。不要加进 `isExpensiveWrite`。

内部 API 不变：`action` 仍是 `add | search | list`，改成引用 `MEMORY_ACTION` 常量。

---

## 7. 常量与 `limit`

放 [`packages/contracts/src/memory.ts`](../packages/contracts/src/memory.ts)：

```ts
export const MEMORY_LIST_LIMIT_DEFAULT = 50;
export const MEMORY_LIST_LIMIT_MAX = 100;
export const MEMORY_SEARCH_LIMIT_DEFAULT = 8;
export const MEMORY_SEARCH_LIMIT_MAX = 32;
export const MEMORY_RECALL_LIMIT = 8;
export const MEMORY_SNIPPET_LENGTH = 72;
export const MEMORY_TEXT_MAX_LENGTH = 500;
export const MEMORY_FILE = "MEMORY.md";
export const NEO_DIR = ".neo";
export const MEMORY_ACTION = { add: "add", search: "search", list: "list" } as const;
export type MemoryAction = (typeof MEMORY_ACTION)[keyof typeof MEMORY_ACTION];
export type MemorySource = "manual" | "agent";
```

已核实的替换点：

- `50`：client 默认、server 公开 GET、server 内部 list、Desk `?limit=50`、侧车默认。
- `100`：只在 client 钳制，改到 Service。
- `8`：inject、client search 默认、侧车 search 默认、`neo-memory.ts` 工具描述 "Default 8."。
- `32`：只在侧车 `Field(le=32)`，控制面 search 现在无校验透传。
- `72`：`catalog.ts` `snippet` 默认、Web 显式传入、Desk `slice(0, 72)`（Desk 没有省略号）。
- 路径：`inject.ts` 写 `MEMORY.md`，`session.ts` 读同一文件名。本方案只改记忆读写路径，不收拢全仓 `.neo`。

侧车 Python 无法 import TS 常量。`app.py` 顶部用同名大写常量，值必须相同。`memory.test.ts` 与 `app_test.py` 各锁一条「默认 / 上限」断言。

归一化（Service，带单测）：

```ts
export function normalizeLimit(
  raw: string | number | null | undefined,
  fallback: number,
  max: number,
): number {
  if (raw === null || raw === undefined || raw === "") {
    return fallback;
  }
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(max, value);
}
```

用例：缺省 / 空串 / `"abc"` / `NaN` / `-5` / `3.7` / `1e9` / 正好等于 max / max+1。非法与小于 1 回退 fallback；`3.7` 变成 `3`；越界钳到 max。

取舍：非法 `limit` 回退而不是 400，因为它是可选展示参数。正文非法（空 / 超长）仍然 400，二者不要混。

---

## 8. 逐文件改动

### 8.1 侧车

[`.cursor/skills/tencent-lighthouse-db/mem0/app.py`](../.cursor/skills/tencent-lighthouse-db/mem0/app.py)：

- `_require_owned_memory(memory_id, user_id)`：`get` 失败 500；无记录或 `user_id` 不符 404。
- `PUT`：校验归属 → 可选比对 `updated_at` → `update` → `get` → `{ results: [...] }`。
- `DELETE`：`user_id` 可选 query；给了就走归属。
- `AddBody.infer` 默认 `False`；`text` 加 `max_length`。
- 删 `search` / `list` 的 `except TypeError`。
- `/health` 去掉 `llm_base`。
- [`app_test.py`](../.cursor/skills/tencent-lighthouse-db/mem0/app_test.py) 与 [`smoke-mem0.sh`](../.cursor/skills/tencent-lighthouse-db/mem0/smoke-mem0.sh) 按 §10。收尾删 `neo_smoke` 的测试数据。

### 8.2 contracts

[`packages/contracts/src/memory.ts`](../packages/contracts/src/memory.ts)：

```ts
export type MemoryMetadata = { source?: MemorySource; runId?: string };
export type MemoryItem = {
  id: string;
  text: string;
  score?: number;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: MemoryMetadata;
};

export function memoryEdited(item: Pick<MemoryItem, "createdAt" | "updatedAt">): boolean {
  const created = Date.parse(item.createdAt ?? "");
  const updated = Date.parse(item.updatedAt ?? "");
  if (!Number.isFinite(created) || !Number.isFinite(updated)) {
    return false;
  }
  return updated > created;
}
```

`memoryHint` 文案补上「也可以改」。`index.ts` 导出新符号。

### 8.3 控制面 client

[`packages/control-plane/src/memory/client.ts`](../packages/control-plane/src/memory/client.ts)：

- `normalizeMemoryResults` 保留 `createdAt` / `updatedAt`，`metadata` 只取 `source` / `runId`。
- `updateMemory({ id, userId, text, updatedAt? })`。
- `deleteMemory(id, userId)`：破坏性签名，typecheck 报出漏改点。
- `listMemories` / `searchMemories` 的 `limit` 改为必填 `number`，去掉 `Math.min` / `Math.max`。
- `Mem0Error` 构造带 `{ cause }`。

### 8.4 Service + 路由

- 新文件 `service.ts`：校验、归一化、映射 `Mem0Error` → `MemoryServiceError`。
- [`server.ts`](../packages/control-plane/src/api/server.ts)：公开与内部记忆分支改调 Service；`PATCH` / `DELETE` 合并到 `/v1/memories/:id`，排除 `search` 段（现有正则会让 `DELETE /v1/memories/search` 变成删一条 id 叫 search 的记忆）。
- `sendMemoryError`：404 不泄漏；502/503 用 C 类码。
- `/health` 的 mem0 只回 `configured`。
- [`inject.ts`](../packages/control-plane/src/memory/inject.ts)：`MEMORY_RECALL_LIMIT`、`NEO_DIR`、`MEMORY_FILE`。

### 8.5 Worker

[`packages/worker/src/session.ts`](../packages/worker/src/session.ts)：`readUserMemory` / `readProjectInstruction` 只对 `ENOENT` 返回空；其余 `console.warn`（路径 + 错误码，不打文件内容）。读路径用 `NEO_DIR` + `MEMORY_FILE`。

---

## 9. 三端功能适配

三端已经是同一套机制（同一用户、同一 Mem0、同一 `/v1/memories`），管理面都是看 / 记 / 删，缺的都是「改」。适配是三页各加编辑。

| 端 | 今天的管理面 | 源码 | 发布节奏 |
| --- | --- | --- | --- |
| Web | 列表 / 客户端搜索 / 记一条 / 删 | [`MemoriesPage.tsx`](../packages/web/src/components/MemoriesPage.tsx) | 与控制面同发 |
| Desk | 同构，无分页，`window.confirm` 删除，截断无省略号 | [`desk/ui/MemoriesPage.tsx`](../packages/desk/ui/MemoriesPage.tsx) | Electron 包，可能落后 |
| mobile | 同构：`listMemories` / `addMemory` / `deleteMemory`，抽屉有「记忆」 | RN [`CloudScreens.tsx`](../packages/mobile/src/screens/CloudScreens.tsx)、DOM [`CloudPages.tsx`](../packages/mobile/src/web/CloudPages.tsx)、[`client.ts`](../packages/mobile/src/api/client.ts) | 商店 / 侧载，可能落后 |

对话路径三端都不用改。Agent 仍走 `neo_memory_add`。编辑后**下一条新 Run** 才会把新文本写进 `.neo/MEMORY.md`。正在跑的对话不会热更新。

共享层只放 contracts，不抽跨端组件：

- 类型：`MemoryItem` / `MemoryMetadata` / 错误码
- 文案：`memoryHint` / `memoryErrorMessage` / `memoryEdited`
- 常量：`MEMORY_SNIPPET_LENGTH` / `MEMORY_TEXT_MAX_LENGTH` / `MEMORY_LIST_LIMIT_*`
- 读错误体：`readMemoryError(body)` → 优先 `message`，回落 `error`

### 9.1 Web

入口不变：`#/memories`、底栏「记忆」、加号里「记忆」。

```ts
type Editor = { mode: "new" } | { mode: "edit"; id: string; original: string; updatedAt?: string };
```

- 记一条 / 编辑共用 `CatalogModal`，标题「记一条」/「改这条」。
- 新增：POST + `refresh()`。
- 编辑：PATCH，**就地替换**，避免列表顺序把刚改的条目跳走。
- 文本没变：关弹窗，不发请求。
- 卡片加「编辑」，保留「删除」+ `useConfirm`；`memoryEdited` 为真则 `badge="改过"`。
- 搜索改 `POST /v1/memories/search`（300ms 防抖）。空查询用已加载列表。
- 输入框 `maxLength={MEMORY_TEXT_MAX_LENGTH}`。
- 删 `MemoryRow` 和 [`packages/web/src/memory.test.ts`](../packages/web/src/memory.test.ts)。
- `memoryHint` 改成「不对的可以改或删」。

### 9.2 Desk

入口不变：`#/memories`、轨上「记忆」。状态机与 Web 相同，控件用 `Modal` / `IslandButton`。

- 截断改用 `MEMORY_SNIPPET_LENGTH` 并补省略号。
- 「改过」用标题旁 `<em>`。
- 删除仍 `window.confirm`。
- 旧包：继续看 / 记 / 删，没有「编辑」。降级，不是断裂。

### 9.3 mobile

已有 `listMemories` / `addMemory` / `deleteMemory`、RN 记忆页、DOM lab 记忆页、抽屉「记忆」。RN 和 DOM **两套 markup 都要改**。

1. `client.ts` 加 `searchMemories` / `updateMemory`。错误读 `message ?? error`。
2. props 从 `{ onAdd, onDelete }` 加上 `onUpdate`。记一条仍是页内输入框；编辑用点卡片打开第二块输入，保存走 PATCH 就地替换。
3. 搜索防抖打 `POST /v1/memories/search`。
4. `memoryEdited` 为真时卡片标「改过」。
5. 删除用 RN `Alert` / DOM `confirm`。
6. 旧包：继续看 / 记 / 删，没有「编辑」。

不做：对话加号里再塞「记忆」；不做离线缓存；不把 `CatalogModal` 搬进 RN。

### 9.4 发布对三端的含义

```
侧车 → 控制面（含 Web 静态）→ Desk 打新包 → mobile 打新包
```

Web 与控制面同发，当天就有编辑。Desk / mobile 未升级期间：看 / 记 / 删仍可用。不要等商店审核齐了再发控制面。

---

## 10. 兼容性

- 侧车 `DELETE` 可选 `user_id`：老控制面行为不变。
- 侧车新增 `PUT`：无人调用，无害。
- `deleteMemory` 签名破坏：仅控制面内部，typecheck 兜住。
- `MemoryItem` 新字段全可选。
- 存量记忆创建时 `updated_at == created_at`（Mem0 `_create_memory`），`memoryEdited` 为 false。
- 无 schema 迁移。
- `/health` 去掉 `mem0.url`：仓库内只有 `memories.test.ts` 读它。

---

## 11. 测试（AIR + BCDE）

AIR：继续用 `setMem0FetchForTests`，不打真 Mem0，用例互不依赖。

侧车 pytest：

- PUT 本人：200，`update` 收到 `text=`，返回 `{ results }`。
- PUT 换人 / 不存在：404，且 `update` 未被调用。
- PUT 无 key：401；空 text：422。
- PUT `updated_at` 不一致：409。
- DELETE 匹配 / 不匹配 / 不带 `user_id`（兼容路径）。
- `infer` 默认 False。
- 常量上限与 TS 同值。

控制面 [`memories.test.ts`](../packages/control-plane/src/api/memories.test.ts)：

- PATCH 200，出站是 `PUT`，`user_id` 等于会话用户。
- PATCH 空 / 超长：400，无出站。
- PATCH 未登录：401；侧车 404 → `{ error: "记忆不存在", code: "MEMORY_NOT_FOUND", message: "记忆不存在" }`。
- PATCH 409。
- DELETE 出站 URL 含 `user_id=<会话用户>`。
- `DELETE /v1/memories/search` 不再当删除。
- `GET ?limit=abc` 出站 `limit=50`，不是 `NaN`。
- `POST /search { limit: 33 }` 出站 `limit=32`。
- `/health.mem0` 只有 `configured`。

单元：`normalizeLimit` 全部分支；`normalizeMemoryResults` 保留时间戳；`memoryEdited`（缺字段 / 非法日期 / 相等 / updated 更大）；`memoryErrorMessage` 码表。

冒烟：改一条，断言文本变、`created_at` 不变；假 `user_id` 改 → 404；收尾删除 `neo_smoke`。

全量：`pnpm typecheck` + `pnpm test`。覆盖率自检（不进 CI）：

```bash
npx tsx --test --experimental-test-coverage \
  packages/control-plane/src/memory/*.test.ts \
  packages/control-plane/src/api/memories.test.ts \
  packages/contracts/src/memory.test.ts
```

---

## 12. 发布、回滚、实现 PR

顺序不能反。控制面先发则 `PATCH` 打旧侧车得 405，控制面没有能力探测。

```
1. deploy-mem0.sh
2. 卡口：应用机 curl PUT 一个不存在的 id，期望 404；拿到 405 就停
3. deploy.sh（control-plane + web）
4. neorun.cloud 记忆页改一条，刷新仍在，带「改过」
```

回滚：控制面可单独回；侧车回滚必须先回控制面。无 schema 变更。

| 实现 PR | 内容 | 发布 |
| --- | --- | --- |
| 1 | 侧车：归属、PUT、可选 `user_id`、`max_length`、`infer` 默认 False、删 TypeError 分支、health 收窄、pytest、smoke | `deploy-mem0.sh` |
| 2 | `deleteMemory(id, userId)` + DELETE 回归锁 + `?limit=abc` 不再 NaN | `deploy.sh` |
| 3 | Service、错误体、常量、乐观锁、PATCH；Web / Desk / mobile 三页都加编辑 | `deploy.sh`；Desk / mobile 另打客户端包 |
| 4 | 侧车 `user_id` 改必填 | `deploy-mem0.sh` |

---

## 13. 明确不做与有意偏离

不做：编辑历史 UI、`neo_memory_update`、项目级 scope、自动抽取、相似度去重、用 `score` 重排、Admin 审计、全仓 CSRF、全局 `readJson` 体积上限、把 `.neo` 全仓 9 处一次性收拢。

偏离：

- 测试文件与源码同目录：`noEmit` + glob 已满足「不进构建产物」，迁目录是全仓重构。
- 不引入日志门面 / eslint：只落约定层。
- 不拆 DO/DTO/VO：`MemoryItem` 跨层复用。
- 不加 CSRF token：CORS `origin: *` 且未开 credentials，cookie `SameSite=Lax`；全站缺口另案。
- 不用悲观锁：单条整体覆盖，乐观锁足够。
- 非法 `limit` 回退不 400：见 §7。
