# Neo Mobile（iOS / Android）

对话页、CLI、Desk、Telegram / 微信公众号都已经是 `/v1` 的宿主。手机端是**下一个同级客户端**，不是新的 Agent 内核，也不是 Desk 的缩小版。

本文是落地蓝图。合约仍在 [`packages/contracts`](../packages/contracts)。终端客户端见 [cli.md](./cli.md)。Desk 本机执行见 [desk.md](./desk.md)。总架构见 [architecture.md](./architecture.md)。现状地图见 [architecture-overview.md](./architecture-overview.md)。

---

## 1. 一句话结论

**手机只发任务、订事件、收推送、做交付动作。Agent loop、工具、仓库、Provider Key 全部留在云端。**

对标对象是 Cursor Cloud Agent 的手机查看 / 跟进面，以及本仓库已经落地的 `packages/cli`，不是本机 `agent`、不是 Desk 的 `loop === "desk"`，也不是把 `packages/web` 原样塞进 App Store。

今天就能从手机用 Neo 的两条路：

| 路径 | 能做什么 | 缺什么 |
| --- | --- | --- |
| 手机浏览器打开现网对话页 | 登录、开 Run、流式看工具和答复、跟进 | 后台一关 SSE 就断；没有系统推送；窄屏还能用，但不是 App |
| Telegram / 微信公众号发一句 | 开新对话；做完 / 开 PR 会推回来 | 看不到直播 token、工具卡、Diff、文件树；一条消息 = 一条新 Run |

要「桌面上那个图标、能推送、能接着聊」，再做 iOS / Android 客户端。不要把上面两条误当成已经有移动端。

---

## 2. 不变量（先锁死）

和 CLI 同一套红线，见 [architecture.md §2](./architecture.md) 和 [cli.md §1](./cli.md)：

1. **loop 在 VM，不在手机。** 手机不跑 pi，不 `read` / `edit` / `bash`，不持有 Provider Key。
2. **会话权威在控制面。** 手机不做本地会话库；列表、transcript、状态都以 `/v1` 为准。
3. **多端是订阅制。** Worker 只生产一次。手机和浏览器、CLI 一样先拉 `GET /v1/runs/:id/transcript`，再订 `GET /v1/runs/:id/events`（`after` / `Last-Event-ID`）。
4. **不做 Desk 目标。** `ExecutionTarget` 的 `loop === "desk"` 需要本机 git 目录和 Electron worker。手机没有这个执行面。P0–P2 只发云端目标 `{ loop: "cloud", tools: "cloud" }`。
5. **IM 入口继续独立。** Telegram / 微信 webhook 仍是公开 ingress，不改成要登录，也不冒充 App。

```
iOS / Android / PWA
        │  /v1  + SSE +（后台）Push
        ▼
 control-plane          llm-gateway
        │                    ▲
        │ spawn              │ run JWT
        ▼                    │
     worker + pi  ───────────┘
```

---

## 3. 和现有面怎么分工

| 宿主 | 现在做什么 | 手机要不要复用 |
| --- | --- | --- |
| `packages/web` | 完整对话页：登录、流式、Diff、文件树、产物、项目、定时任务、存 Key | **协议和产品语义复用**；UI 壳不要直接嵌进 WebView 当正式 App |
| `packages/cli` | headless `/v1`：创建、订 SSE、跟进、归档、diff、PR | **客户端实现的模板**。手机 SDK 应对齐 `ControlPlaneClient` |
| `packages/desk` | Electron + 本机 worker + lease/claim | **不复用。** 那是另一条执行轴 |
| Telegram / 微信 / 企微 / SMTP | 发一句开 Run；idle / error / PR 推文本 | **推送通道的先例。** App 推送接到同一份 `notifyRunFinished` / `notifyPrReady` |
| Slack / GitHub（架构里的客户端） | GitHub webhook 已落地；Slack 未做 | 继续当 ingress，不是 App |

`Run.source` 今天有 `web | cli | slack | github | api | automation | telegram | wechat | desk`。手机开的 Run 应标 `ios` / `android`（或先用一个 `mobile`，按平台再拆）。列表、配额、通知都靠这个区分来源，不要再用 `web` 或 `api` 糊过去。

---

## 4. 三条实现路线（只选一条当主路径）

### A. 手机浏览器 + 现有 Web（现在就能用）

`packages/web` 已经按窄屏做了侧栏、登录、Enter 发送策略和 `visualViewport`。现网是 `https://neorun.cloud/`。域名与证书见 [production-domain.md](./production-domain.md)。

适合：验证「手机上能不能下任务」。  
不适合：当 iOS / Android 产品。iOS 后台会杀掉页面；没有 APNs。

**立刻可做的增强（不必开 App 工程）：** 加 Web App Manifest + service worker 做成 PWA；idle / PR 用 Web Push（浏览器允许时）。这是过渡，不是商店包。

### B. Capacitor / Cordova 包一层 `packages/web`（不推荐当正式方案）

看起来快：同一套 React 打进 WKWebView / Android WebView。

实际会踩：

- App Store / 国内应用市场对「套壳浏览器」审核紧
- `EventSource` 在后台一样死
- Web 的设置页、Desk 目标选择、文件树会把手机壳撑爆
- 现网已经是 HTTPS；套壳仍过不了审核，也解决不了后台 SSE
- 相机、钥匙串、推送最后还是要写原生插件，套壳优势消失

内部 TestFlight / 自己用可以拿来探路。**不要把它当成要上架的 iOS / Android 端。**

### C. 独立移动客户端 + 同一套 `/v1`（推荐）

新 package，只依赖合约和 HTTP。UI 按手机重画：对话列表、一条 transcript、composer、推送。

技术选型（本仓库是 pnpm / TypeScript monorepo）：

| 选项 | 为什么可以 | 为什么要小心 |
| --- | --- | --- |
| **Expo（React Native）推荐** | 和 Web / Desk 同语言；EAS 出 TestFlight / Play 内测；推送走 Expo Push 再转 APNs / FCM | 不要 import `packages/web` 的组件（渲染器不同）；流式列表要自己写，别套 Web 的 DOM transcript |
| Flutter | 一套 UI 两套商店；列表性能稳 | Dart 和现有 contracts / CLI 不共享代码；团队要同时养两套语言 |
| 双原生（SwiftUI + Kotlin） | 体验最好 | 两份 UI、两份 SSE，当前控制面体量不值 |

**主路径：Expo。** 控制面继续一个进程。手机不是第四个 Deployment。

---

## 5. 产品切面（按依赖，不按日历）

手机不是把 Web 每一页搬过去。第一期只做「人在路上也能下任务、看进度、被叫醒」。

### P0 — 能当云端对话的第二块屏

必须：

- 登录：`POST /v1/auth/login`，把 `neo_sess_*` 存系统钥匙串 / EncryptedSharedPreferences，之后所有请求带 `Authorization: Bearer`
- 列表：`GET /v1/runs`
- 开对话：`POST /v1/runs`，`source` 为 `ios` / `android`，`target` 为云端；`repoUrls` 用已有 Environment / 上次用过的仓库，不要假装手机 cwd 是工作区
- 打开一条：`GET /v1/runs/:id` + `GET /v1/runs/:id/transcript`，按 `transcriptGroups` 渲染（工具在最终答复上面，和对话页一样）
- 直播：前台订 SSE；断线带 `after` 重连；再短轮询 Run 状态兜底（CLI 已经这么做）
- 跟进 / 停止 / 归档：现有 follow-ups / abort / archive
- 选模型：Flash / Pro，读 `GET /v1/settings/llm`，**不要在手机上存 Provider Key**
- 推送：idle / error / PR 打开系统通知，点进去深链到该 Run

可以没有：文件树、终端面板、Desk 本机文件夹、设置里写 DeepSeek Key、项目协作完整页、定时任务编辑器。

验收：手机登录 `admin`，对已有 Environment 说一句话，能看到流式文字和工具卡；切到别的 App 再回来，transcript 不丢；Run 结束后锁屏能收到一条通知。

### P1 — 像对话页的随身版

手机主打 cloud，对齐对象就是对话页已经落地的那几刀。**已接**（`MobileClient` + 两个壳同一套）：

- 个人记忆：`GET|POST /v1/memories`、`POST /v1/memories/search`、`PATCH|DELETE /v1/memories/:id`；抽屉进「记忆」。Mem0 没配就显示 `configured: false`，不当报错
- 站内 Inbox：`GET /v1/inbox`、`POST /v1/inbox/:id/read`；抽屉「消息」带未读角标，点一条有 `runId` 就开对话，否则跳项目
- 产物：`GET /v1/runs/:id/artifacts` + `POST …/save-to-project`（非项目对话按控制面语义禁掉）
- 出错跳诊断：`GET /v1/runs/:id/diagnostics`
- 技能启停：`POST|DELETE /v1/plugins/:id/install`、`POST …/enable`
- 空态 Recipe 与专家团：`BUNDLED_RECIPES` 预填 `prompt` / `expertId` / `expertTeamId` / `pluginIds`
- 列表多选归档、删除已归档；长会话「加载更早」（`?limit=&before=`）
- 图片附件：走现成的 `images[]`，服务端零改动。两个壳都在发之前把图**归一化成 JPEG 并把长边压到 1600**——SDK 54 的 picker 默认 `Passthrough`，iPhone 取出来是几 MB 的 HEIC，而 worker 的扩展名映射只认 png/webp/gif、`mediaType` 又原样当 vision mime 传给模型，不归一化会同时错在格式和体积上。实验室用 canvas，RN 用 `expo-image-manipulator`

**仍后置：** Diff 摘要、环境 / 快照选择、槽位占用提示（`GET /v1/vms` 客户端已封装，未做产品面）。

### P2 — 和 Web 对齐的管理面

- 工作区只读文件树（`GET /v1/runs/:id/fs`）
- 项目资产 / 成员 / 邀请审批 / 转交（`MobileClient` 已封装，产品面只做了项目列表与接受邀请）
- 定时任务只读 + 开关（已有）
- 设备管理：登出其它手机、吊销 session

**明确不做（任何一期都不要混进来）：**

- 手机上跑 worker / 选本机文件夹当工作区
- 在 App 里贴 `DEEPSEEK_API_KEY`
- 把 Telegram 用户直接映射成 App 账号（ingress 仍然是公开 webhook）
- 为了手机把 Agent loop 搬到控制面
- 复制 Desk 的登记 / claim / 本机工作区

---

## 6. 协议：已经够用，只补三件东西

P0 客户端直接打现有最小集，和 [architecture.md §13](./architecture.md) 相同：

```
POST   /v1/auth/login|logout
GET    /v1/me
GET    /v1/runs
POST   /v1/runs
GET    /v1/runs/:id
POST   /v1/runs/:id/follow-ups
POST   /v1/runs/:id/abort
POST   /v1/runs/:id/archive
GET    /v1/runs/:id/transcript
GET    /v1/runs/:id/events      SSE
GET    /v1/settings/llm
GET    /v1/vms
GET    /v1/environments
```

Web 已经证明：**晚到的端先拿 snapshot，再跟直播**。手机只要把 CLI 的重连策略搬过去。

要补的控制面能力只有这些：

### 6.1 `Run.source` 加上移动端

`packages/contracts` 的 `RunSource` 增加 `ios` | `android`。创建时客户端必须带上。分析、配额、通知文案用这个字段。

### 6.2 设备登记与推送

现有 `notify/dispatch.ts` 会推 Telegram / 企微 / HTTP / SMTP。手机要接到**同一触发点**（`notifyRunFinished`、`notifyPrReady`），不要再写第二套「做完了」判断。

```
POST   /v1/devices              登记 platform + push token（Expo / APNs / FCM）
DELETE /v1/devices/:id          登出时删
GET    /v1/devices              可选，设置页列出本账号设备
```

payload 至少带 `runId`、`kind`（`idle` | `error` | `pr`）、标题、深链。15 秒去重已经有，沿用。

前台开着 SSE 时可以不弹本地横幅，避免一条 Run 结束响两次。后台或进程被杀时只靠推送叫醒，点开后再拉 transcript，不要指望 SSE 在后台活着。

### 6.3 鉴权不要靠 query string

今天 Web / Desk 用 `EventSource`，浏览器不能自定义头，所以把 token 放进 `?access_token=`。`readApiCredential` 也认这个参数。

原生客户端用 `fetch` / `URLSession`，**SSE 和 REST 都走 `Authorization: Bearer`**。不要再把 `neo_sess_*` 写进 URL（会进代理日志）。`access_token` 只留给浏览器 EventSource。

Session TTL 已是 30 天（`SESSION_TTL_MS`），手机钥匙串存同一条即可。P1 再考虑 refresh；P0 401 就回登录页。

---

## 7. 现网阻塞：HTTPS 和域名

域名和 TLS 已经齐：`https://neorun.cloud/`（Caddy + Let's Encrypt → `:8080`）。解析与证书见 [production-domain.md](./production-domain.md)。

商店包 / TestFlight 用这个 HTTPS 主机名，不要再打明文 IP：

- iOS App Transport Security 默认拒绝明文 HTTP
- Android 9+ 同样默认清掉 cleartext
- APNs / FCM 的 webhook、Universal Link / App Link 都要真实 HTTPS 域名

不要为了 App 再开一个网关，不要买腾讯云付费证书，不要点轻量控制台一键 HTTPS（只支持应用镜像）。

深链建议和现有 hash 对齐，方便推送 / 分享来回跳：

| 面 | 形式 |
| --- | --- |
| Web（已有） | `https://<host>/#/runs/<id>` |
| App | `neo://runs/<id>` 以及 `https://<host>/#/runs/<id>`（Universal Link） |
| 通知正文 | 继续带这条 URL，没有 App 的人落到对话页 |

---

## 8. 流式和后台（手机和浏览器不一样）

控制面 SSE 已有 15s ping、`Last-Event-ID` / `after` 续订、多端订阅。CLI 还用短轮询 Run 状态兜底。手机照抄这条，不要改成 WebSocket，除非 SSE 被某家运营商或审核网络掐断（到那一步再加，协议事件不变）。

系统会杀掉后台套接字。正确策略：

```
前台：transcript snapshot → SSE
进后台：关 SSE，登记「这条 Run 还在跑」
被推送叫醒 / 用户点回来：再拉 snapshot + after 续订
进程被杀：只靠推送；冷启动走列表或深链
```

不要做 VOIP / 无限后台保活来「一直看 token」。那是审核雷，也对 4C/4G 现网槽位没好处。

渲染对齐对话页，不要对齐 CLI 的纯文本刷：

- 用 `buildTranscriptSnapshot` / `transcriptGroups`：同一轮里，工具组在 `message.end` 之后单独成行，下一句模型文字再开气泡
- `message.delta` 合并后再上屏，不要每个 token 触发一次全列表 diff（Web 已经用 rAF 批处理）
- 历史分页用现有 transcript 分页常量，不要一次拉整棵事件树

---

## 9. 仓库和包（模块，不是服务）

继续一个 monorepo。建议：

```
packages/
  contracts/          已有。RunSource / RunEvent / transcript 给所有客户端
  cli/                已有。ControlPlaneClient 是协议参考实现
  web/                已有。产品语义参考，不给 RN import
  mobile/             Expo 壳（App.tsx）；Vite :5175 视觉实验室在 src/web
    src/api/          对齐 cli 的 client + sse（Bearer，不走 query token）
    src/screens/      RN 登录 / 首页 / 列表 / 对话
    src/native/       SecureStore、推送登记、neo:// 深链
```

以后若 CLI 和 Mobile 开始复制粘贴 HTTP，再抽 `@neo-cloud-agent/client`。P0 **不要**为了手机先拆 SDK 包——CLI 文档已经写了「稳定 SDK 以后再做」。先让 App 直接打 `/v1`，合约继续只从 `packages/contracts` 出类型。

RN 不能直接依赖 Node 的 `http.get`（CLI 的 `streamSse` 是这个）。用 `fetch` + `ReadableStream`，或 Expo 的网络栈。解析帧可以抄 `packages/cli/src/sse.ts` 的 `parseSseChunk`。

---

## 10. 和 Telegram / 微信怎么并存

不要做「有了 App 就关掉公众号」。两者服务的是不同场景：

| | IM | App |
| --- | --- | --- |
| 身份 | webhook 密钥 / 公众号 token，**不是**用户登录 | `neo_sess_*`，只看自己的 Run |
| 输入 | 一条文本 → 新 Run | 列表里继续聊、steer / follow_up |
| 输出 | 做完推一段字 | 直播 + 结束后推送 |
| 适用 | 走路随口丢任务 | 要看 Agent 做了什么、要跟进改方向 |

同一账号以后若要「公众号开的 Run 出现在 App 列表」，必须先做 **IM 身份绑定到 userId**。现在 Telegram / 微信开的 Run 不走登录。这是单独一期，不要塞进 P0 App。

---

## 11. 建议的实现顺序

按依赖排，不按人天估：

1. **现网 HTTPS + 域名**（没有这个，原生包在真机上就卡死）
2. 合约：`RunSource` 增加 `ios` / `android`；控制面创建 Run 时原样保存
3. `POST /v1/devices` + 在现有 notify 触发点扇出 Expo / FCM / APNs
4. `packages/mobile`：登录、列表、开 Run、snapshot + SSE、跟进。`pnpm dev:mobile` 是 `:5175` 视觉实验室；真机用 `cd packages/mobile && pnpm start`（Expo Go）。默认 API `https://neorun.cloud`，局域网调试填电脑 `http://IP:8080`（不要填 `127.0.0.1`）。
5. 登录后 `POST /v1/devices`；`neo://runs/:id` 和通知点回该 Run；前台已有 SSE 时不重复本地横幅
6. P1：图片、产物、Diff、环境选择
7. （可选）Web 加 PWA / Web Push，给不想装 App 的人

P0 验收仍用 mock gateway 就能走通（和 `pnpm test` / `pnpm neo` 一样）。真模型只用来看推送文案和长流式是否卡顿。

---

## 12. 明确不做什么

1. **不要 fork pi 或在手机上嵌 `createAgentSession`。**
2. **不要把 Provider Key 写进 App。** 设置页继续只显示 `configured`。
3. **不要用 WebView 套完整 Web 当上架方案。**
4. **不要为手机新开控制面或新仓库。**
5. **不要在后台保活 SSE。** 推送 + 回前台续订。
6. **不要把 Desk 本机执行搬到手机。**
)
