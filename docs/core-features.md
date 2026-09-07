# Neo Cloud Agent 核心功能

只列对话页（Web）上真正撑起产品的能力。依据仓库实现，不写尚未落地的设想。Desk / Mobile / CLI / 管理台是同一套 `/v1` 的其它宿主，不单独算核心功能。

## 怎么用这份清单

| 列 | 含义 |
| --- | --- |
| 用户可见行为 | 登录后在 `https://neorun.cloud/` 或本地对话页上能看见什么 |
| 快乐路径 | 默认本地 / 现网能走通的主路径 |
| 边界 | 空输入、鉴权、权限、超时、缺密钥等 |
| 依赖 | 环境变量、进程、HTTPS |

自动化边界用例见 [`e2e/`](../e2e/README.md)。外部 computer-use 逐步脚本见 [`e2e/checklist.yaml`](../e2e/checklist.yaml)。

## 入口与怎么启动

| 环境 | 对话页 | API | 怎么起 |
| --- | --- | --- | --- |
| 本地开发 | `http://127.0.0.1:5173` | `http://127.0.0.1:8080` | `pnpm dev`（control-plane `:8080` + llm-gateway `:8081`），再 `pnpm dev:web` |
| 本地生产构建 | control-plane 托管 `packages/web/dist` | `http://127.0.0.1:8080` | `pnpm build:web` 后只起 `pnpm dev`，打开 `:8080` |
| 现网 | `https://neorun.cloud/` | 同源 `/v1` | Caddy → `:8080`。裸 IP `http://62.234.211.200/` 只做运维兜底 |
| 管理台（非核心） | 本地 `:5176`，现网 `/admin/` | `:8090` | `pnpm dev:admin` |

默认账号：`admin` / `123456`（`DEFAULT_ADMIN=1`）。对话页表单不预填，也不能跳过。`ACCOUNTS_REQUIRED=0` 才允许匿名。Gateway 没配 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 时 `upstream=mock`，足够走完 Run。默认 `WORKER_RUNTIME=local`，`POST /v1/runs` 在本机拉 worker。现网 `WORKER_RUNTIME=vm`，`AGENT_KERNEL=pi`。

---

## 1. 账号登录与会话隔离

**用户可见行为。** 未登录只看得到 `#auth-gate`。登录 / 注册 /（宽屏）服务令牌三个页签。登录成功后侧栏显示账号，可退出。每个用户只能看见自己的 Run。

**快乐路径。** 用户名或 11 位手机号 + 密码 → `POST /v1/auth/login` → 得到 `neo_sess_…`，写入 `localStorage["neo.apiToken.v2"]` 和 `neo_session` cookie → `#auth-gate` 隐藏，出现 `#composer`。

**边界。**

| 情况 | 可观察结果 |
| --- | --- |
| 账号或密码为空 | 提交按钮 `#auth-submit` 禁用；点了也只在前端提示「请输入用户名或手机号，以及密码」 |
| 密码错误 / 不存在的账号 | `401`，`error: invalid account or password`；`#auth-error` 显示同一句 |
| `POST /v1/auth/bootstrap` | 固定 `403`「请使用账号登录」 |
| 注册缺手机号 / 非法用户名 / 密码短于 6 位 | `400`（「请填写有效的手机号」「用户名不合法」「密码至少 6 位」） |
| 用户名须 `^[a-z][a-z0-9._-]{1,31}$`，手机号须大陆 11 位 | 不满足即 `400` |
| 重复手机号 | `409`「手机号已注册」 |
| 注册成功未审核 | `201` + `pending: true`，**不发 token**；登录 `403`「账号待管理员审核」 |
| 停用账号 | `403`「账号已停用」 |
| 未带会话打 `/v1/*` | `401` `{ error: "unauthorized" }` |
| 退出后再用旧 token | `401` |
| 看别人的 Run | `404`（不是 `403`，避免探测） |
| 窄屏（≤860px） | 没有「服务令牌」页签 |
| 服务令牌模式 | 需要 `CONTROL_PLANE_TOKEN`；错误令牌 `401` |

**依赖。** `ACCOUNTS_REQUIRED`（默认必须登录）、`DEFAULT_ADMIN` / `DEFAULT_ADMIN_PASSWORD`、`BOOTSTRAP_EMAIL`、`ADMIN_EMAILS`、`CONTROL_PLANE_TOKEN`。元数据可走 `DATABASE_URL`，不设则 `.neo/runs/.control` JSON。

---

## 2. 新建对话（Create Run）

**用户可见行为。** 侧栏「新对话」`#new-chat`，主区标题「和云端 Agent 说话」，`#prompt` 输入，`#send` 发送。可选 Agent/Ask、Flash/Pro、专家、执行目标（云端 / Desk）。可粘贴最多 4 张图片。

**快乐路径。** 登录后输入非空 prompt → `POST /v1/runs`（`source: "web"`，`repoUrls` 来自设置里的仓库，缺省可 `[]`）→ `201` + Run id → hash 变成 `#/runs/<id>`，`#transcript` 出现用户消息，状态 `#status` 变为进行中。

**边界。**

| 情况 | 可观察结果 |
| --- | --- |
| prompt 与图片都空 | `#send` disabled，不发请求 |
| `POST /v1/runs` 无 `prompt` | `400` `{ error: "prompt is required" }` |
| 无 `repoUrls` 且无 `envId` | `400` `{ error: "prompt and repoUrls are required" }`（空数组合法） |
| 未登录 | `401` |
| 图片 `data` 以 `obj:` 开头（内部指针） | `400` `invalid image payload` |
| Ask 模式 | 前端给正文加上「只阅读和回答…」前缀，仍走同一接口 |
| 选了 Desk 但没选机器 | 不发请求，transcript 出现「先选一台电脑…」 |
| 发起该对话的 Desk 离线 | composer 锁定，提示「发起这条对话的 Desk 离线…」 |
| 额度用尽 / 并发配额 | `429` |
| 槽满（现网 `WORKER_RUNTIME=vm`） | Run `NOT_YET_STARTED`，事件 `run.queued`，**不报错** |
| 刷新发送中 | 会话 token 仍在；SSE 重连后继续收事件 |
| mock 上游 | 无真实模型 key 也能创建并跑到 `IDLE`（本地 `LLM_UPSTREAM=mock`） |

**依赖。** 登录。推理要 `llm-gateway` + `LLM_UPSTREAM` / 对话页保存的 `.neo/llm-upstream.env`。执行要 `WORKER_RUNTIME`（local/vm/docker/firecracker）。内核 `AGENT_KERNEL=pi`（默认）或 `agentscope`（还要 `neo-loop :8082`）。仓库可以是 `fixtures/toy-repo` 或 GitHub URL；egress 可能拦住远程 clone。

---

## 3. 跟进、停止、归档、删除

**用户可见行为。** 已有 Run 时再发送走 follow-up。进行中出现 `#abort`。更多菜单里 `#archive-run`；归档后才出现 `#delete-run`。归档后 `#prompt` disabled，hint「对话已归档，无法继续发送。」

**快乐路径。** `POST /v1/runs/:id/follow-ups` `{ text }` → `201` queued → worker / loop 接着跑。`POST .../abort` 停止。`POST .../archive` 释放 VM。归档后再 `DELETE .../runs/:id` 软删，列表不再出现。

**边界。**

| 情况 | 可观察结果 |
| --- | --- |
| follow-up 无 `text` | `400` `{ error: "text is required" }` |
| 已归档 / 已过期再跟进 | `400`，消息含 `archived` / `expired` |
| Desk host 离线再跟进 | `409`，文案是 Desk 离线或未绑定 |
| 未归档就删除 | `409` |
| 别人的 Run 上跟进 / 归档 / 删除 | `404` |
| 并发两条 follow-up | 都 `201`，都进队列 |
| 停止中 | `#abort` 文案变成「停止中」 |

**依赖。** Run 仍在、worker 或 loop 能认领。IDLE 卸槽后跟进会从 session 备份恢复。

---

## 4. 实时 Transcript / SSE

**用户可见行为。** `#transcript` 按时间拆行：工具卡在最终答复上面。Markdown、Diff 片段、思考、token 用量。多标签订阅同一条 SSE。

**快乐路径。** 打开 Run → `GET /v1/runs/:id/transcript` 拉快照 → `GET /v1/runs/:id/events` 跟直播。状态 pill `#status[data-busy=true]`。

**边界。**

| 情况 | 可观察结果 |
| --- | --- |
| 未登录拉 transcript / events | `401` |
| 别人的 Run | `404` |
| 不存在的 id | `404` |
| SSE 过多 | `429`（`RATE_LIMIT_SSE`，默认生产开） |
| 刷新 | 先压缩 transcript，再跟直播；对话不丢（`.control` / MySQL） |
| 空对话 | buddy 主页或「和云端 Agent 说话」，`#transcript` 空态 |

**依赖。** 热事件可走 `REDIS_URL`；不设则进程内总线。对象存储默认 `RUNS_DIR/.objects`。

---

## 5. 工作区文件、Diff、产物

**用户可见行为。** 有 Run 后顶栏出现会话标签「Diff / 终端 / 产物」。文件树在设置页「工作区」`#file-tree`（只在已有 `runId` 时挂载）。Diff 是 `#run-diff`，产物是 `#run-artifacts`。文件内容超过 200KiB 截断；目录最多 200 条。

**快乐路径。** `GET /v1/runs/:id/fs?path=` 列目录；`content=1` 读文件。`GET .../diff` 看本轮补丁。产物由 worker 上传，对话页下载（可带签名 query）。

**边界。**

| 情况 | 可观察结果 |
| --- | --- |
| 还没发过消息 | 文件树 hint「发送任务后可以浏览工作区文件。」 |
| 未登录 / 别人的 Run | `401` / `404` |
| `path=../` 逃出工作区 | `400` `path escapes workspace` |
| 不存在的路径 | `404` `path not found` |
| 工作区被回收 | `workspace.state=evicted`，UI「工作区已按磁盘回收清掉…」 |
| 无 diff | 「工作区没有可展示的 diff。」 |
| 产物缺 name/content | `400` `name and content are required` |
| 产物 > 1_500_000 字节 | `400` `artifact too large` |
| 错误签名下载 | `401` |
| 非项目对话保存产物到项目 | `400`「只有项目对话才能保存到项目」；UI 也有这句 hint |

**依赖。** 工作区在 `RUNS_DIR/<runId>`。现网 idle 15 分钟写回再卸槽（`WORKER_IDLE_RELEASE_MS`）。

---

## 6. 沙箱终端

**用户可见行为。** 会话标签「终端」打开 `#run-terminal`。这是可打字的工作区 shell，不是 setup 日志。按钮「新终端」「关闭」。输入框 `aria-label="终端输入"`。

**快乐路径。** `POST /v1/runs/:id/term` → `201` `{ id, cwd, shell, alive, pty }` → SSE `.../term/:termId/events` → `POST .../term/:termId` `{ data }` 写入。

**边界。**

| 情况 | 可观察结果 |
| --- | --- |
| 未登录 | `401` |
| 没有 Run | UI「先发一条消息，等沙箱工作区起来再敲命令。」 |
| 别人的 Run / 把 termId 用到另一条 Run | `404` |
| 单次写入 > 16384 字节 | `400` `input too long` |
| 同一 Run 超过 4 个活终端 | `409`「每个对话最多开 4 个终端」 |
| Desk / 本机对话 | `409`「本机对话请在 Desk 右侧栏用终端。网页打不开那台电脑上的 shell。」 |
| 关闭不存在的 session | `404` |
| 刷新 | 先 `GET .../term` 列出已有 session，再订 SSE |

**依赖。** 控制面本机要有 `zsh`/`bash`。Desk 目标不能从网页开。`RATE_LIMIT_TERM`（默认 1800）。

---

## 7. 语音听写（讯飞）

**用户可见行为。** composer 麦克风按钮（`aria-label` 含「语音」或听写状态）。成功则把文字填进 `#prompt`，**不会自动发送**。HTTPS 现网走实时麦克风；HTTP / 非安全上下文改成选录音文件。

**快乐路径。** `GET /v1/speech/iat` → `{ configured: true }` → 按住/点击开麦 → 浏览器 PCM → `POST /v1/speech/iat`（control-plane 用短寿命 JWT 转到 gateway）→ gateway 连 `wss://iat-api.xfyun.cn/v2/iat` → 预览文本进输入框。

**边界。**

| 情况 | 可观察结果 |
| --- | --- |
| 未登录 GET/POST | `401` |
| 服务令牌 POST（非用户会话） | `401` `{ error: "login_required" }` |
| Gateway 未配讯飞三件套 | `GET` `{ configured: false }`；UI「听写未配置。把讯飞 APPID / APIKey / APISecret 写到服务器后再试。」 |
| Gateway 进程不在 | `GET` `{ configured: false }`；`POST` `502`「听写服务不可用」 |
| 已配密钥但讯飞拒绝 | `503`「听写未配置」或上游错误文案 |
| `http://` 非 localhost（现网裸 IP） | 不走 live mic；窄屏弹出「选一段录音」；文案含「当前是 HTTP，浏览器不给实时麦克风」 |
| `https://neorun.cloud` | 安全上下文，允许 live mic |
| 不支持的浏览器 | 「这个浏览器不支持麦克风。请换 Chrome / Safari，或直接打字。」 |
| 选了照片/视频当录音 | 「这是照片或视频。请选录音文件（m4a / mp3 / wav）…」 |
| 空录音 / 没听清 | 「没听清，请再录一次，或直接打字。」 |
| 归档后 | 麦克风不渲染（`sendLocked`） |

**依赖。** `IFLYTEK_APP_ID` / `IFLYTEK_API_KEY` / `IFLYTEK_API_SECRET` 只放 **llm-gateway** 所在机器的 `.env`，不要进 APK / 前端。现网必须 HTTPS。`RATE_LIMIT_SPEECH`。

---

## 8. 专家与技能目录（预填 Run）

**用户可见行为。** 顶栏「专家」「技能」→ `#/experts`、`#/skills`。composer `#agent-expert` 下拉。`@` 提及专家/技能/资产。点「用这个开对话」只预填 `POST /v1/runs` 的 `expertId` / `pluginIds`，**没有**插件 git 市场，**没有** `/v1/search`。

**快乐路径。** 登录后 `GET /v1/experts` 看到内置专家（如 `exp_reviewer`）；`GET /v1/expert-teams`、`GET /v1/plugins`。选中后新 Run 带上 id。

**边界。**

| 情况 | 可观察结果 |
| --- | --- |
| 未登录打开目录页 | 仍被 `#auth-gate` 挡住；API `401` |
| 创建个人专家缺字段 / 正文过长 | `400`；正文上限 8000 字 |
| 个人专家超过上限 | `400`「最多 N 个个人专家」 |
| 服务令牌列专家 | 只能看到 bundled，不能 `POST`（`401 login_required`） |
| `@` 无匹配 | 「没有可引用的专家、技能或资产」 |

**依赖。** 登录。技能物化进工作区 `.neo/skills`。管理台可下发内置专家（现网 `/admin/`，不是对话页核心路径）。

---

## 明确不算核心（有页面，但本套件不当作成品主路径）

这些在仓库里存在，本文件不展开，E2E 核心套件也不当主用例：

- 项目协作、定时任务、跨对话记忆（要 `MEM0_URL` + `MEM0_API_KEY`）
- 管理台、Desk Electron、Mobile Expo、CLI `pnpm neo`
- Java `neo-loop` / `kernel=agentscope`（内核开关，不是用户功能）
- GitHub PR / webhook、MCP OAuth、架构图 `/architecture`

记忆页未接 Mem0 时 API 仍 `200` `{ configured: false, memories: [] }`，UI 标题「记忆还没接上」——checklist 里只作负向探测。

---

## 核心功能 × 用例 ID

与 [`e2e/checklist.yaml`](../e2e/checklist.yaml) 的 `id` 对齐。

| 功能 | 快乐路径 | 边界（节选） |
| --- | --- | --- |
| 1 登录 | `auth.login-happy` | `auth.empty` `auth.wrong-password` `auth.expired` `auth.isolation` `auth.register-*` `auth.narrow-no-token-tab` |
| 2 新对话 | `runs.create-happy` | `runs.empty-ui` `runs.missing-prompt` `runs.missing-repo` `runs.unauth` `runs.invalid-image` `runs.concurrent` |
| 3 生命周期 | `runs.follow-up-happy` | `runs.follow-empty` `runs.follow-archived` `runs.delete-before-archive` `runs.abort-unauth` |
| 4 Transcript | `transcript.snapshot-happy` | `transcript.unauth` `transcript.isolation` `transcript.reload` |
| 5 工作区 | `workspace.fs-happy` | `workspace.escape` `workspace.missing` `workspace.artifact-too-large` `workspace.bad-sign` |
| 6 终端 | `term.open-happy` | `term.unauth` `term.too-long` `term.max-sessions` `term.cross-run` `term.desk-denied` |
| 7 语音 | `speech.configured-true`（需密钥） | `speech.unauth` `speech.login-required` `speech.not-configured` `speech.gateway-down` `speech.http-insecure` |
| 8 专家技能 | `catalog.experts-happy` | `catalog.unauth` `catalog.expert-create-unauth` `catalog.memory-unwired` |
