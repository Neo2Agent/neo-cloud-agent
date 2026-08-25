# Neo 后管调研：New API、竞品、以及怎么接

本文回答三件事：

1. 模型配置能不能整段交给开源项目 [New API](https://github.com/QuantumNous/new-api)（原 Calcium-Ion/new-api）。
2. 管理端用户管理能不能直接用 New API 的用户体系。
3. Cursor / Devin / LiteLLM / One API / Portkey 等竞品后管怎么拆，Neo 该抄哪一层。

结论先说：**模型渠道、定价、上游 Key、模型侧限流，适合交给 New API；Agent 用户、Run、槽位、SSE、项目协作，必须留在 Neo 控制面。不要用 New API 替换 `llm-gateway`，也不要把两套用户表合成一张。**

---

## 1. 我们现在缺什么

对话页只有「贴一个 DeepSeek / OpenAI Key + 选 Flash/Pro」。控制面另有组织配额（月 token、同时跑的对话）和接口限流（IP / 登录 / 建 Run / SSE / Gateway）。

缺的是竞品后管里那一层：

| 能力 | 现状 | 竞品通常放哪 |
| --- | --- | --- |
| 多上游渠道、故障切换、模型目录 | 单上游 + 几个别名 | 网关 / 渠道后台 |
| 按用户 / Key 的模型配额与账单 | 组织月 token | 网关账单 + Agent 用量 |
| 用户列表、角色、禁用 | 写死 `admin` / `123456`，无列表 API | 产品后管（不是网关） |
| Run / 槽位 / 环境 / 自动化运营 | 散落在 `/v1` 和 `/health` | Cloud Agent dashboard |
| 接口限流可视化 | 只有 `GET /v1/rate-limits`（未合入 main 时甚至没有） | 网关限流页 + 产品 API 限流页 |

两套问题不要混：

- **模型资产**：Key、渠道、价格、上游 429、按 token 计费。
- **Agent 运营**：谁开了几条对话、槽满没、VM 是否空闲、谁在刷登录。

New API 擅长前者。Cursor / Devin 的 Admin Dashboard 擅长后者。LiteLLM 偏工程网关。Neo 是 Cloud Agent 控制面，两边都要，但不要做成一个进程。

---

## 2. New API 是什么

[QuantumNous/new-api](https://github.com/QuantumNous/new-api) 是 One API 路线的下一代 LLM 网关 + AI 资产后台。Go 单二进制，Docker 默认 `:3000`，自带 Web 控制台。文档：[docs.newapi.pro](https://docs.newapi.pro/zh/docs/guide/feature-guide)。

角色：普通用户 / Admin / Root。

**用户侧：** 注册登录、OAuth（GitHub / Discord / Telegram / OIDC）、2FA、令牌、用量日志、钱包充值、订阅、操练场。

**管理侧：**

- 渠道：上游供应商、多 Key 轮询、权重、优先级、探测、自动禁用
- 用户：列表、角色、分组、配额、启用/禁用（`/console/user`）
- 令牌：额度、模型白名单、IP 白名单、分组
- 模型 / 分组 / 倍率：模型倍率 × 补全倍率 × 分组倍率
- 限流：单 IP 的分/时/日；分组 JSON，例如 `{"default":[200,100],"vip":[0,1000]}`；多机靠 `REDIS_CONN_STRING`
- 日志、兑换码、支付（EPay / Stripe）、性能监控

鉴权是 **New API 自己的 sk- 令牌**，不是 Neo 的 run JWT。持久化是 SQL（Postgres / MySQL）；Redis 做缓存、Session、分布式限流。

许可证是 **AGPL-3.0**。不要把源码 vendoring 进本仓库。正确用法是：**独立进程，HTTP 当上游**；改它的代码就要按 AGPL 开源对应改动。

---

## 3. 能不能用 New API 接管「整个模型配置」

**渠道、Key、定价、上游限流、模型目录：可以，而且应该。**

Neo 今天的模型配置只有：

- `.env` / `.neo/llm-upstream.env` 里的 `LLM_UPSTREAM*`、`DEEPSEEK_API_KEY`
- 对话页 `POST /v1/settings/llm` 写同一份文件
- `packages/llm-gateway` 把 `neo/deepseek` 等稳定 id 改写成 flash / pro，再打上游

New API 能直接替换的是「上游那一段」：

```
worker (run JWT)
  → Neo llm-gateway（验 JWT、打码、按 run/org 限流、记 Run usage）
    → New API（sk- 令牌；渠道 / 倍率 / 上游限流 / 日志）
      → DeepSeek / OpenAI / vLLM / 其它渠道
```

控制面只要把 Gateway 的 `LLM_UPSTREAM_BASE_URL` 指到 New API 的 OpenAI 兼容地址，`LLM_UPSTREAM_API_KEY` 换成 New API 令牌。对话页不再收 Provider Key，只选「对外模型 id」。

**不能交给 New API 的模型相关能力：**

1. **Run-scoped JWT。** 架构写死：VM 只能拿短寿命 JWT，不能拿 Provider Key，也不该拿长期 `sk-`。New API 令牌是账户级、可设无限额。若 worker 直连 New API，密钥进不可信 VM，和「推理在云端」冲突。
2. **稳定对外 id。** 产品要的是 `neo/deepseek`，不是渠道里一长串上游名。映射仍应在 Neo Gateway 或 contracts 里。
3. **按 Run 聚合 usage、写 RunEvent。** New API 日志是按令牌/用户，没有 `runId`。Agent transcript 的 token 卡片必须继续在控制面记。
4. **熔断写成 Run 事件。** New API 会切渠道，但控制面看不到，对话页无法提示「上游挂了已换模型」。
5. **Vision / 退役别名。** flash → vision、`deepseek-chat` → flash，是产品语义，应留在 Neo。

所以：**整段模型配置的「运营面」走开源 New API；「对 Agent 的契约面」留在 Gateway。** 不是把 `packages/llm-gateway` 删掉换成 New API。

---

## 4. 管理端能不能接入 New API 的用户管理

**能「接入」，不能「替代」。**

New API 用户 = 网关租户（谁有额度、哪组渠道、哪张令牌）。

Neo 用户 = Agent 租户（谁拥有 Run、项目、Desk、session cookie `neo_sess_`）。

两套身份今天对不齐：

| | Neo | New API |
| --- | --- | --- |
| 账号 | 默认必须登录，注册关闭，写死 admin | 完整注册 / OAuth / 2FA |
| 凭证 | session 或 `CONTROL_PLANE_TOKEN` | 网站 session + `sk-` API 令牌 |
| 授权对象 | Run / 项目成员 | 渠道分组 / 模型白名单 |
| 列表 API | 没有 `GET /v1/users` | `/console/user` + 管理 API |

若把 Agent 登录改成 New API 登录：

- 控制面 `resolveActor`、项目成员、Desk、自动化 `userId` 全要迁
- worker JWT 的 `sub` / `orgId` 要跟 New API user id 对齐
- 现网 `admin` / MySQL `users` 表作废或双写
- AGPL 后台和本仓库 UI 深度耦合，升级痛苦

正确接法是 **映射，不是合并**：

1. Neo 继续做 Agent 账号（以后再补用户列表、角色、禁用）。
2. New API 里一个（或按 org 一个）服务账号，Gateway 只用这一张 `sk-`。
3. 可选：给每个 Neo 用户在 New API 建子用户 / 子令牌，方便按人看模型账单。用 New API 管理 API 同步，失败时回退到共享令牌。
4. Neo 后管「用户统计」数的是 Run、token、并发槽、429，不是 New API 钱包。两边数字并排展示，不要加总成一个「余额」。

用户管理要做在 **Neo 后管**，字段对齐 Agent：邮箱、org、角色、Run 数、本月 token、并发、最后登录、是否禁用。New API 用户页只当「模型租户」外链或只读镜像。

---

## 5. 竞品后管怎么拆

### 5.1 Cursor（最直接的对标）

[Team Dashboard](https://cursor.com/docs/account/teams/dashboard) 和 [Cloud Agents settings](https://cursor.com/docs/cloud-agent/settings) 是两层：

- **账号后管：** Overview、Usage analytics（按人 / 按产品面：客户端、Cloud Agents、automations、Bugbot）、Spend limits（软硬限额、50/80/100% 告警）、成员限额、Admin API Key、账单。
- **Cloud Agent 后管：** 环境与 Build、默认模型与仓库、egress（allow all / default+allowlist / allowlist only）、team follow-ups、长任务、computer-use。

没有「在 Cloud Agent 页里配 OpenAI Key 渠道轮询」。模型供应在账号/账单层，Agent 运营在 Cloud Agent 层。

**该抄：** 后管按「团队用量 + Agent 运营」分页，不要做成中转站后台。用量按人、按 Run、按模型切。限额分软硬。环境 / 槽位 / egress 是一等公民。

**不该抄：** 完整计费与发票（P3 才做账务）。

### 5.2 Devin

[Admin Portal](https://docs.devin.ai/desktop/guide-for-admins) + [ACU 消费](https://docs.devin.ai/admin/billing/enterprise)：

- Enterprise / Org / Member 三层角色
- 消费单位是 ACU，不是裸 token
- [Usage policies](https://docs.devin.ai/enterprise/features/usage-policies)：成员页按利用率排序，超限高亮，点进去看 session 效率
- 分析：Adoption、Team Activity、Cost；SSO / SCIM / 服务密钥

**该抄：** 用户表按利用率排序；组织限额和成员限额分开；会话成本和平台成本分开看。

**不该抄：** 先做 SSO/SCIM；先发明 ACU。用「token + 并发 Run + 槽占用分钟」够现网。

### 5.3 New API / One API（中转站后台）

One API 是轻量前辈；New API 是现在中文社区的默认后台：渠道、令牌、用户、倍率、限流、充值。

**该抄：** 渠道健康、模型定价、按 Key 日志、Redis 分布式限流的产品形状。这些直接部署 New API，不要在 TypeScript 里重写。

**不该抄：** 把 Agent 控制面做成中转站（兑换码、邀请返利、Stripe 充值、操练场）。那是卖 API 的产品，不是 Cloud Agent。

### 5.4 LiteLLM Proxy

工程网关：`config.yaml`、fallback、least-busy、虚拟 Key、team budget、Prometheus。企业 UI 有 Org/Team/User 和预算。用户体系弱于 New API，路由强于 New API。

**何时选 LiteLLM 而不是 New API：** 更在意 fallback 链、程序化路由、告警进 Grafana，而不是中文 GUI / 充值。Neo 现网是 4C 轻量 + 中文运维，**第一期更适合 New API**。路由策略变复杂再评估 LiteLLM 当上游，Gateway 契约不变。

### 5.5 Portkey / Helicone / LangSmith

可观测与网关：请求日志、延迟、成本、缓存、按 Key 限流。不管 VM、PR、环境盘。

**该抄：** 后管要有「模型调用失败率 / 延迟 / 成本」小卡片，数据可从 New API 日志或 Gateway 打点来。

**不该抄：** 再嵌一套 tracing SaaS 当后管本体。

### 5.6 Open WebUI / Dify / FastGPT

聊天前端或工作流。用户和知识库管理很完整，但不管隔离 VM 和 Run 状态机。

**不该当 Neo 后管。** 对话页已经在 `packages/web`。

---

## 6. 推荐架构

```
浏览器 --> 控制面 :8080 --> Neo 后管 /admin（用户 / Run / 槽 / 429）
                 |
                 +-- 可选只读拉取 New API 管理 API（渠道状态、令牌额度）

worker -- run JWT --> llm-gateway :8081 -- sk- --> New API :3000 --> Provider
                         |                            |
                    验 JWT、别名、Run usage      渠道、倍率、上游限流
```

| 放 Neo | 放 New API | 不要做 |
| --- | --- | --- |
| Agent 登录、项目、Desk | 渠道与上游 Key | worker 直连 New API |
| Run / 跟进 / 归档 / PR | 模型定价与分组 | 两套用户表强行合并 |
| VM 槽、Build、egress | 上游 429 / 渠道探测 | 把 New API 打进本仓库 |
| `/v1` 登录与建 Run 限流 | 模型侧 QPS / 配额 | 在设置页继续贴 Provider Key |
| 按 Run 的 token 卡片 | 按令牌的调用日志 | 用 New API 替换 JWT Gateway |

现网两台轻量：New API 和 MySQL/Redis 可以同库机（`101.42.105.230`）或同应用机另开容器。Gateway 只打内网 `http://new-api:3000/v1`。不要把 New API 控制台裸露到公网而不加鉴权。

---

## 7. Neo 后管第一期信息架构

对照 Cursor Dashboard + Devin Consumption，而不是把 New API 控制台嵌成唯一后台。

1. **总览**  
   今日 / 本月：活跃用户、新 Run、进行中、排队、本月 token、槽占用、Gateway / `/v1` 的 429 次数。

2. **用户**  
   表：邮箱、org、角色、Run 数、本月 token、当前并发、最后活跃、状态。按利用率排序。操作：禁用、调并发/月 token 上限。数据来自 Neo `users` + Run 聚合。New API 子额度若已同步，加一列「模型配额」。

3. **对话 / Agent**  
   全站 Run：状态、模型、来源（web/cli/automation）、耗时、token、错误。点进 transcript / diagnostics。对标 Cloud Agents 列表，不是聊天记录导出器。

4. **容量**  
   `WORKER_RUNTIME`、槽数、空闲释放、warm pool、Build。现网 2 槽必须能一眼看到谁占着。

5. **模型**  
   Neo 侧：默认对外模型、是否指向 New API。  
   外链或只读拉取：New API 渠道状态、模型倍率。  
   第一期 **不要** 在 React 里重做渠道 CRUD。

6. **限流**  
   两块并排，避免运维以为「配了 Redis 就一切都在 Redis」：  
   - Neo：`ip` / `login` / `create_run` / `sse` / `llm_run`… 现网有 `REDIS_URL` 时 QPS 在 Redis，SSE 和 Gateway 仍是内存。  
   - New API：全局 IP 限流、分组 `[每分钟, 每小时]`，`REDIS_CONN_STRING` 才跨节点。

7. **系统**  
   `/health` 展开：metadataStore、eventBus、llmConfigured、authRequired。密钥仍只写本机 `.env`，后管只显示「已配置 / 未配置」。

权限：仅 `admin`（或日后 `role=admin`）可开 `/admin`。普通会话 404。不要把后管和对话设置页混在一个抽屉里。

---

## 8. 建议的落地顺序

不要先画完整中转站后台。

1. **接入 New API 当 Gateway 上游**（配置，几乎不写产品代码）  
   部署 New API → 配 DeepSeek 渠道 → 发一张服务令牌 → `LLM_UPSTREAM=openai`（兼容协议）+ `LLM_UPSTREAM_BASE_URL=http://<new-api>/v1` + 该令牌。对话页停收 Provider Key。

2. **Neo `GET /v1/admin/overview` + `/v1/admin/users`**  
   聚合已有 Run / quota / rate-limit / health。补用户列表（现在 store 只有按 email/id 查）。

3. **`packages/web` 加 `/admin`**  
   总览、用户表、Run 表、槽、限流只读。模型区放 New API 控制台链接。

4. **可选同步**  
   按 Neo 用户建 New API 令牌，后管能看到「模型侧剩余额度」。

5. **后置**  
   SSO、充值、按人硬拦截模型调用、LiteLLM fallback。完整账务仍按架构后置。

---

## 9. 明确不做什么

1. 不 fork New API 进 monorepo（AGPL + 升级成本）。
2. 不让 worker 拿 New API `sk-`。
3. 不用 New API 登录替换 `POST /v1/auth/login`。
4. 不在 Neo 里重做渠道/倍率/兑换码。
5. 不把接口限流和模型限流配在同一个表单里而不标明存储（Redis vs 内存 vs New API）。

---

## 10. 参考

- New API 仓库与功能指南：https://github.com/QuantumNous/new-api 、https://docs.newapi.pro/zh/docs/guide/feature-guide
- 用户 / 令牌 / 限流：`/console/user`、`/console/token`、系统设置「限流设置」
- Cursor Dashboard / Cloud Agent settings：https://cursor.com/docs/account/teams/dashboard 、https://cursor.com/docs/cloud-agent/settings
- Devin Admin / ACU / usage policies：https://docs.devin.ai/desktop/guide-for-admins 、https://docs.devin.ai/admin/billing/enterprise
- LiteLLM 企业后台：https://docs.litellm.ai/docs/simple_proxy
- 本仓库架构：`docs/architecture.md` §7（Gateway 必须验 run JWT）
