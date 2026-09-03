# 记忆编辑：技术方案

配套分析见 [memory-edit-analysis.md](./memory-edit-analysis.md)（为什么要做、代价在哪）。本文只讲怎么做：契约、逐文件改动、测试、发布顺序、回滚。

一句话范围：**给用户记忆加「改」，并把「改」和「删」都补上归属校验。** 不做自动抽取、不做项目级作用域、不做编辑历史 UI。

---

## 1. 设计决策

### 1.1 归属校验放侧车，不放控制面

| 方案 | 代价 |
| --- | --- |
| **侧车内校验**（选这个） | 一次跨主机往返。检查离数据最近，未来任何调用方都受保护。逻辑只有一份 |
| 控制面校验 | 要新增 `GET /memories/{id}`，北京应用机 → 库机两次往返，且每个写路由都得自己比对一遍 |

侧车内用 `Memory.get(memory_id)`（一次向量库主键取行，不用 embedding）拿到 `user_id` 比对。控制面**不做二次校验**——两套真相比没有校验更糟。

不匹配和不存在都返回 **404**，不返回 403：不泄漏「这个 id 存在」。这也和 `/v1/experts/:id` 现有的 404 语义一致。

### 1.2 编辑是原地 `update`，不是「删除 + 新增」

`mem0ai==2.0.19` 的 `Memory.update(memory_id, text=...)` 保留 `created_at`、写 `updated_at`、身份字段不可变、重新 embed、写一条 `UPDATE` history。把编辑实现成删+增会丢掉这一整套，还多一个可能中途失败的两步事务。

### 1.3 侧车只发一次

侧车部署走 `mem0/deploy-mem0.sh`（库机 docker build + compose up），不在常规 `deploy.sh` 路径上，是整件事里最贵的一步。所以**把侧车的全部改动一次发完**（归属校验 + `PUT` 路由），控制面和 UI 再分批跟上。`PUT` 路由先落地、暂时没人调用，是有意为之的 expand/contract。

### 1.4 公开 API 用 `PATCH`

仓库现有约定是 `PATCH`（`/v1/me`、`/v1/experts/:id`、`/v1/desks/:id`）。侧车对内用 `PUT`，因为它是整段文本替换，且和 Mem0 Platform 的形状一致。

### 1.5 Agent 不给编辑工具

`neo_memory_add` 够用。给 Agent 加 `neo_memory_update` 需要它先拿到 id，而 `neo_memory_search` 现在只把 id 放在 `details` 里、正文只返回文本。让模型改自己写过的记忆，收益不明、错误面变大。等有真实需求再说。

---

## 2. API 契约

### 2.1 Mem0 侧车（`mem0/app.py`）

```
PUT    /memories/{memory_id}                  新增
       body: { user_id: str, text: str }
       200 { results: [ { id, memory, created_at, updated_at, user_id, ... } ] }
       401 未带 key ｜ 404 不存在或不属于该 user_id

DELETE /memories/{memory_id}?user_id=...      user_id 从「无」变成「可选，给了就强制」
       200 ｜ 401 ｜ 404 不存在或不属于该 user_id
```

`PUT` 返回体包成 `{ results: [...] }` 是为了让控制面现成的 `normalizeMemoryResults` 直接吃（`Memory.update()` 本身只返回一句 `{'message': ...}`，所以要 update 完再 `get` 一次）。

`text` 为空时侧车返回 **422**（pydantic 的 `min_length=1`），不是 400。用户看不到它：控制面在 §3.4 已经先用 400 拦掉了。

`DELETE` 的 `user_id` 这一轮是**可选**的，老控制面不带也照常工作——这是零停机的关键。等控制面全量发完，再用一行把它改成必填（见 §7 的 PR 4）。

### 2.2 控制面公开 API

```
PATCH  /v1/memories/:id     新增
       body: { text: string }
       200 { memory: MemoryItem }
       400 text 为空 ｜ 401 未登录 ｜ 404 记忆不存在 ｜ 502/503 Mem0 不可用

DELETE /v1/memories/:id     行为变化：现在会带上当前用户
       200 { ok: true } ｜ 401 ｜ 404
```

限流不用额外配：`actorRateLimitPolicies` 对所有 `/v1/` 非 auth 路径给 `api`，对 `PATCH` 再加 `write`，已经覆盖。不要把它加进 `isExpensiveWrite`——编辑不打 LLM，只是一次本地 embed，和 `POST /v1/memories` 同级。

### 2.3 内部 API

不变。`POST /internal/runs/:id/memories` 仍然只有 `add` / `search` / `list`。

---

## 3. 逐文件改动

### 3.1 `mem0/app.py`

```python
class UpdateBody(BaseModel):
    user_id: str = Field(min_length=1)
    text: str = Field(min_length=1)


def _owned_or_404(memory_id: str, user_id: str) -> dict[str, Any]:
    try:
        item = get_memory().get(memory_id)
    except Exception:
        # Backing-store failure, not a bad id.
        raise HTTPException(status_code=500, detail="memory_lookup_failed")
    if not item or item.get("user_id") != user_id:
        # Same 404 for missing and not-yours: do not leak which ids exist.
        raise HTTPException(status_code=404, detail="memory_not_found")
    return item


@app.put("/memories/{memory_id}")
def update_memory(
    memory_id: str,
    body: UpdateBody,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    _owned_or_404(memory_id, body.user_id)
    memory = get_memory()
    memory.update(memory_id, text=body.text)
    return {"results": [_jsonable(memory.get(memory_id))]}
```

`delete_memory` 加一个可选 query 参数：

```python
@app.delete("/memories/{memory_id}")
def delete_memory(
    memory_id: str,
    user_id: str | None = None,        # PR 4 改成必填
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> Any:
    require_key(x_api_key, authorization)
    if user_id:
        _owned_or_404(memory_id, user_id)
    return _jsonable(get_memory().delete(memory_id))
```

顺带修好的一个毛病：删一个不存在的 id，现在 `_delete_memory` 抛 `ValueError` → 500。带上 `user_id` 之后会先在 `_owned_or_404` 拿到干净的 404。

### 3.2 `packages/control-plane/src/memory/client.ts`

```ts
export async function updateMemory(input: {
  id: string;
  userId: string;
  text: string;
}): Promise<MemoryItem | null> {
  const parsed = await mem0Request("PUT", `/memories/${encodeURIComponent(input.id)}`, {
    user_id: input.userId,
    text: input.text,
  });
  return normalizeMemoryResults(parsed)[0] ?? null;
}

export async function deleteMemory(id: string, userId: string): Promise<void> {
  await mem0Request(
    "DELETE",
    `/memories/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`,
  );
}
```

`deleteMemory` 多一个必填参数是**故意的**：这是个破坏性签名变更，`pnpm typecheck` 会把所有漏改的调用点报出来。

`normalizeMemoryResults` 保留时间戳（现在被丢掉）：

```ts
if (typeof raw.created_at === "string") {
  item.createdAt = raw.created_at;
}
if (typeof raw.updated_at === "string") {
  item.updatedAt = raw.updated_at;
}
```

Mem0 的 `get` / `get_all` / `search` 三条路径都会带这两个字段（`mem0/memory/main.py` 1240、1361、1708 行附近），所以列表页拿得到，不是只有编辑返回值才有。

### 3.3 `packages/contracts/src/memory.ts`

```ts
export type MemoryItem = {
  id: string;
  text: string;
  score?: number;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export function memoryEdited(item: { createdAt?: string; updatedAt?: string }): boolean {
  const created = (item.createdAt ?? "").trim();
  const updated = (item.updatedAt ?? "").trim();
  return Boolean(created && updated && created !== updated);
}
```

`memoryEdited` 放 contracts 而不是各写一遍，理由和现有的 `filterMemories` / `memoryHint` 一样：Web 和 Desk 两个记忆页必须表现一致。`index.ts` 跟着导出。

### 3.4 `packages/control-plane/src/api/server.ts`

现在的删除分支替换成一个同时管 `DELETE` 和 `PATCH` 的分支：

```ts
const memoryItem = /^\/v1\/memories\/([^/]+)$/.exec(path);
if (memoryItem && memoryItem[1] !== "search" && (method === "DELETE" || method === "PATCH")) {
  if (actor.kind !== "user") {
    send(res, 401, { error: "login_required" });
    return;
  }
  const memoryId = memoryItem[1] ?? "";
  try {
    if (method === "DELETE") {
      await deleteMemory(memoryId, actor.userId);
      send(res, 200, { ok: true });
      return;
    }
    const body = (await readJson(req)) as { text?: string };
    const text = (body.text ?? "").trim();
    if (!text) {
      send(res, 400, { error: "text is required" });
      return;
    }
    const memory = await updateMemory({ id: memoryId, userId: actor.userId, text });
    if (!memory) {
      notFound(res);
      return;
    }
    send(res, 200, { memory });
  } catch (error) {
    sendMem0Error(res, error);
  }
  return;
}
```

`memoryItem[1] !== "search"` 那一段是顺手补的：现有正则会让 `DELETE /v1/memories/search` 变成「删一条 id 叫 search 的记忆」。

`sendMem0Error` 把 404 的机器码换成人话，删除和编辑都受益：

```ts
send(res, error.status, { error: error.status === 404 ? "记忆不存在" : error.message });
```

### 3.5 Web `packages/web/src/components/MemoriesPage.tsx`

状态从「开不开弹窗」升成「编辑器在编谁」：

```ts
type Editor = { mode: "new" } | { mode: "edit"; id: string; original: string };
const [editor, setEditor] = useState<Editor | null>(null);
```

保存分流：

```ts
const save = () => {
  const text = draft.trim();
  if (!text || busy || !token || !editor) return;
  if (editor.mode === "edit" && text === editor.original) {
    setEditor(null);
    return;
  }
  setBusy(true);
  void (async () => {
    if (editor.mode === "new") {
      const body = await readJson<{ memories?: MemoryRow[]; error?: string }>(
        await api(token, "/v1/memories", { method: "POST", body: JSON.stringify({ text }) }),
      );
      if (body.error) throw new Error(body.error);
      await refresh();
    } else {
      const body = await readJson<{ memory?: MemoryRow; error?: string }>(
        await api(token, `/v1/memories/${encodeURIComponent(editor.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ text }),
        }),
      );
      if (body.error) throw new Error(body.error);
      const updated = body.memory;
      if (updated) {
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
    }
    setDraft("");
    setEditor(null);
  })()
    .catch((caught) => setError(caught instanceof Error ? caught.message : "保存失败"))
    .finally(() => setBusy(false));
};
```

编辑走**就地替换**而不是 `refresh()`：`GET /v1/memories` 的顺序由 Mem0 决定，整页刷新会让刚改完的那条跳走，用户找不到。新增仍然 `refresh()`，因为新条目的 id 只有服务端知道。

卡片加按钮和「改过」角标：

```tsx
<CatalogCard
  key={item.id}
  title={snippet(item.text, 72)}
  description={item.text.length > 72 ? item.text : undefined}
  badge={memoryEdited(item) ? "改过" : undefined}
  initial="记"
  actions={
    <>
      <button
        type="button"
        className="ghost"
        disabled={busy}
        onClick={() => {
          setDraft(item.text);
          setEditor({ mode: "edit", id: item.id, original: item.text });
        }}
      >
        编辑
      </button>
      <button type="button" className="ghost danger" disabled={busy} onClick={() => void remove(item.id)}>
        删除
      </button>
    </>
  }
/>
```

`CatalogModal` 的 `title` 跟着 `editor.mode` 变（「记一条」/「改这条」），`open` 变成 `editor !== null`。`CatalogCard` 已经有 `badge` 和多个 `actions` 的支持，不用动 `Catalog.tsx`。

`packages/web/src/memory.ts` 里的 `MemoryRow` 从手写的 `{ id, text }` 改成直接复用 contracts 的 `MemoryItem`，否则时间戳会在类型层被截掉。

### 3.6 Desk `packages/desk/ui/MemoriesPage.tsx`

同一套状态机和同一套请求，控件换成 Desk 的 `Modal` / `IslandButton`。Desk 没有 `badge`，用一个 `<em>` 放在标题后面。删除仍用 `window.confirm`（Desk 没有 `useConfirm`，不在这次范围里统一）。

---

## 4. 兼容性

| 变更 | 谁会受影响 | 处理 |
| --- | --- | --- |
| 侧车 `DELETE` 多一个可选 `user_id` | 老控制面 | 不带就走老路径，行为不变 |
| 侧车新增 `PUT` | 无 | 纯新增 |
| `deleteMemory()` 签名多一个参数 | 控制面内部 | `pnpm typecheck` 全量报出来 |
| `MemoryItem` 多两个可选字段 | Web / Desk / worker | 可选字段，不破坏现有解构 |
| `MemoryRow` 变成 `MemoryItem` | Web | 超集，只会变宽 |

没有数据迁移。存量记忆的 `updated_at` 由 Mem0 在创建时就写了（等于 `created_at`），所以 `memoryEdited` 对存量条目正确返回 `false`。

---

## 5. 测试

### 5.1 侧车 `mem0/app_test.py`

沿用现有的 `monkeypatch.setattr(slim, "get_memory", lambda: fake)` 打桩风格：

1. `PUT` 命中：`fake.get` 返回 `{"user_id": "u1", ...}` → 200，且 `fake.update` 收到 `text=`。
2. `PUT` 换人：`fake.get` 返回 `{"user_id": "u2"}` → 404，且 `fake.update` **没被调用**。
3. `PUT` 不存在：`fake.get` 返回 `None` → 404。
4. `PUT` 无 key → 401。
5. `DELETE` 带匹配的 `user_id` → 200 且 `fake.delete` 被调用。
6. `DELETE` 带不匹配的 `user_id` → 404 且 `fake.delete` **没被调用**。
7. `DELETE` 不带 `user_id` → 200（兼容路径，PR 4 里改成 422）。

### 5.2 控制面 `packages/control-plane/src/api/memories.test.ts`

1. `PATCH` happy path：200，返回体是 `{ memory }`，且发给 Mem0 的是 `PUT /memories/m1`、body 里 `user_id` 等于**会话用户**（不是请求里能指定的）。
2. `PATCH` 空 text → 400，且没有出站请求。
3. `PATCH` 未登录 → 401。
4. `PATCH` 侧车返回 404 → 控制面 404，body 是 `{ error: "记忆不存在" }`。
5. `DELETE` 现在带 `user_id`：断言出站 URL 含 `user_id=<会话用户>`。这条是**归属校验的回归锁**，不能省。
6. `DELETE /v1/memories/search` 不再被当成删除。

### 5.3 单元

- `client.test.ts`：`updateMemory` 的 method / path / body；`normalizeMemoryResults` 保留 `createdAt` / `updatedAt`。
- `contracts/src/memory.test.ts` 和 `packages/web/src/memory.test.ts`：`memoryEdited` 的三种输入（缺字段、相等、不等）。

### 5.4 冒烟 `mem0/smoke-mem0.sh`

在现有 add / search 之后追加：改一次 → 断言文本变了且 `created_at` 没变；用一个假 `user_id` 去改 → 断言 404。

顺手修一个现有毛病：这个脚本每次部署都往 `neo_smoke` 下写一条记忆，从来不删。收尾加一次 `DELETE ?user_id=neo_smoke`，正好也把新的归属路径顺带冒烟了。

### 5.5 全量

`pnpm typecheck` + `pnpm test` 必须绿。侧车的 `pytest` 在库机或本地容器里跑，不进 `pnpm test`。

---

## 6. 发布顺序与回滚

**顺序不能反。** 控制面先发的话，`PATCH` 打到旧侧车拿 405，`mem0Request` 原样抛成 `Mem0Error("mem0_405", 405)`，用户看到一个看不懂的报错——控制面没有 Mem0 能力探测（`/health` 只报 `configured` 和 `url`），没法优雅降级。

```
1. bash .cursor/skills/tencent-lighthouse-db/mem0/deploy-mem0.sh
      库机 docker build + compose up + smoke

2. 卡口：从应用机确认 PUT 真的在
      curl -sS -o /dev/null -w '%{http_code}\n' -X PUT \
        -H "X-API-Key: $MEM0_API_KEY" -H 'content-type: application/json' \
        -d '{"user_id":"deploy-probe","text":"probe"}' \
        http://101.42.105.230:8888/memories/00000000-0000-4000-8000-000000000000
      期望 404（不存在）。拿到 405 说明侧车没换，停在这里

3. bash .cursor/skills/tencent-lighthouse-deploy/deploy.sh
      control-plane + web

4. 在 https://neorun.cloud 的记忆页改一条，刷新确认还在，且带「改过」
```

回滚：

- 控制面可以单独回滚，侧车多出来的 `PUT` 没人调用，无害。
- 侧车要回滚，必须**先**回滚控制面，否则编辑功能直接 405。
- 两边都不涉及 schema 变更，回滚不用动数据。

---

## 7. PR 拆分

| PR | 内容 | 发布 |
| --- | --- | --- |
| **1** | 侧车：`_owned_or_404`、`PUT /memories/{id}`、`DELETE` 可选 `user_id`、`app_test.py`、`smoke-mem0.sh` | `deploy-mem0.sh` |
| **2** | 安全修复：`deleteMemory(id, userId)`、路由传 `actor.userId`、回归测试 | `deploy.sh` |
| **3** | 编辑：contracts 时间戳 + `memoryEdited`、`updateMemory`、`PATCH /v1/memories/:id`、Web + Desk UI、测试 | `deploy.sh` |
| **4** | 清理：侧车 `user_id` 改必填，删掉兼容分支 | `deploy-mem0.sh` |

PR 2 是纯安全修复，不依赖 PR 3，可以先合先发。PR 4 是一行加一个测试改动，等 PR 2 在现网跑稳之后再发。

---

## 8. 验收

1. 记忆页每条卡片有「编辑」。点开预填原文，改完保存，卡片就地更新，不跳位。
2. 改过的条目带「改过」角标；没改过的没有。
3. 内容没变时点保存直接关弹窗，不发请求。
4. 改完开一条新 Run，`.neo/MEMORY.md` 里是新文本。
5. 换一个账号，拿着别人的记忆 id 打 `PATCH` 和 `DELETE`，都拿 404，且对方的记忆没变。
6. Mem0 没配时记忆页仍然是「还没接上」，不报错。
7. `pnpm typecheck`、`pnpm test`、侧车 `pytest`、`smoke-mem0.sh` 全绿。

---

## 9. 风险

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 发布顺序反了 | 编辑报 `mem0_405` | §6 第 2 步的卡口挡住 |
| 用户和 Agent 同时写同一条 | 后写覆盖先写 | 接受。这个条数量级不值得上乐观锁 |
| 改完撞上另一条重复 | 两条近义记忆 | 接受。`infer=false` 本来就不去重，编辑不会让情况更糟 |
| `update` 的向量写成功、history 写失败 | 向量对、审计缺一条 | Mem0 内部不是事务的，接受。history 现在也没有 UI |
| 侧车 512Mi 顶不住 | 编辑变慢 | 一次编辑 = 一次本地 embed，和现有 `add` 同级，不新增一类负载 |
| 存量记忆没有 `updated_at` | 角标不显示 | Mem0 创建时就写了，`memoryEdited` 对相等值返回 `false`，退化正确 |

---

## 10. 这份方案验证到哪一步

写方案时把风险最高的一段——跨服务的侧车契约——做了一次性原型验证（原型在 `/tmp`，没有进仓库）：把 §3.1 的代码原样打进 `app.py` 的副本，按 §5.1 的用例跑 `pytest`，8 条全过，包括「换个 `user_id` 去 `PUT` 拿 404 且 `Memory.update` 完全没被调用」。

再把原型真实吐出的 `PUT` 返回体喂给控制面现成的 `normalizeMemoryResults`，确认 `{ results: [...] }` 这个包装选对了：`id` / `text` / `userId` / `metadata` 全部落位，唯一缺的就是时间戳——正好是 §3.2 要补的那两行。

没有验证的部分（实现时才知道）：Mem0 在真 pgvector 上的 `update` 时延、`memoryEdited` 在存量数据上的表现、两个 UI 的交互细节。

其余结论来自读 `mem0ai==2.0.19` 的源码（`Memory.update` / `get` / `delete` 的返回值和副作用）和本仓库代码，不是从文档推的。

---

## 11. 明确不做

| 不做 | 为什么 |
| --- | --- |
| 编辑历史 UI | `Memory.history(id)` 有数据，但产品没问。不要为了「有」而做 |
| Agent 的 `neo_memory_update` 工具 | 见 §1.5 |
| 项目级作用域 `scope=user\|project` | 另一个设计，别混进来 |
| 对话结束自动抽取 | 应该排在编辑**后面**，理由见分析文第 4 节 |
| 相似度去重 | 独立话题，和编辑不耦合 |
| 用 `score` 做召回排序 / 阈值过滤 | 真缺口，但属于召回质量，不是管理面 |
| Admin 台的记忆审计 | 没有需求方 |
