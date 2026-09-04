# Neo Cloud Agent 架构

对标 Cursor Cloud Agent：用户从 Web / CLI / Slack / GitHub 发起任务，控制面在云端编排一次隔离 VM 运行；**LLM 推理走云端网关**；**Agent 循环和工具执行在 VM 内**；Agent 内核使用 [pi-agent](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent` + `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`）。

本文是实现蓝图，不是产品文案。**现在仓库里实际长什么样**（12 个 package、三个控制面进程、现网、专家 / 插件、数据流）见 [architecture-overview.md](./architecture-overview.md)。**完整架构图**见 [diagrams/architecture-complete.png](./diagrams/architecture-complete.png)，现网 `https://neorun.cloud/architecture`。合约类型见 [`packages/contracts`](../packages/contracts)。终端客户端见 [`docs/cli.md`](./cli.md)。

---

## 1. 目标与非目标

### 目标

| 能力 | 含义 |
| --- | --- |
| 云端推理 | Provider API Key / 自建推理集群只存在于 LLM Gateway，VM 看不到明文密钥 |
| 隔离执行 | 每个 Run 独占一台短暂 VM（或等价隔离单元），可编译、跑测试、开服务、操作浏览器 |
| pi 内核 | 不自研 Agent loop。用 pi 的 `createAgentSession`、工具、session、compaction、steer / follow-up、extensions |
| 可恢复 | Run 可跟进、可空闲挂起、可在快照上恢复；会话以 JSONL 持久化。跨 Run 的用户 / 项目事实是控制面旁路，不是 pi session，见 [agent-memory-research.md](./agent-memory-research.md) |
| 可交付 | 在独立分支上改代码，push，开 PR，附带 artifacts |
| 可加速 | Environment Builds：后台预装依赖并打盘，新 Run 从热快照启动，而不是每次冷装 |

### 非目标（第一期不做）

- 复刻 Cursor 的 IDE、Tab、本地 sandbox，或把 pi 再嵌进一份本机 TUI
- 多租户计费的完整账务系统（先打点，后对账）
- 在控制面远程 RPC 每一个 `read` / `edit` / `bash`（延迟和带宽都会毁掉 coding agent）——二期重新评估见 [desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md)
- 让 VM 直连 Anthropic / OpenAI / 自建 GPU（密钥与配额会泄漏到不可信环境）
- 让 CLI 在开发者机器上执行工具来「加速」——CLI 只打 `/v1`，见 [cli.md](./cli.md)

---

## 2. 一条必须先锁死的原则

**Agent loop 跑在 VM 里，不跑在控制面。**

pi-coding-agent 的默认工具是本地文件系统工具：`read` / `write` / `edit` / `bash`（可加 `grep` / `find` / `ls`）。这些调用必须在仓库旁边执行。如果把 loop 放在控制面、把工具做成跨网络 RPC：

- 每次读文件都要走控制面 ↔ VM
- bash 的交互、cwd、进程组、tmux 全部失真
- 你等于丢掉 pi，自己重写一个远程执行器

Cursor 的形态也是这个：控制面管生命周期、鉴权、模型和环境；**真正写代码、跑命令的进程在隔离机里**。

LLM「在云端」通过 **LLM Gateway** 实现，而不是把 loop 搬出 VM：

```
VM 内 pi  ──streamFn / OpenAI-compatible──►  LLM Gateway  ──►  Provider / vLLM
                 (run-scoped JWT)              (持有密钥)
```

---

## 3. 总览

```mermaid
flowchart TB
  subgraph clients [Clients]
    Web
    CLI
    Mobile[iOS / Android]
    Slack
    GitHub
    PublicAPI[Public API]
  end

  clients --> GW[API Gateway]

  subgraph control [Control Plane]
    GW --> Orch[Orchestrator]
    GW --> LLM[LLM Gateway]
    Orch --> Env[Env Registry]
    Orch --> Build[Build Service]
    Orch --> SCM[SCM Adapter]
    Orch --> Events[Event Bus]
    Orch --> Artifacts[Artifact Store]
    Orch --> Secrets[Secrets Vault]
  end

  Orch -->|"provision + mTLS"| Worker
  LLM <-->|"run-scoped JWT"| Pi

  subgraph vm [Execution VM]
    Worker[neo-worker]
    Worker --> Pi[pi-coding-agent]
    Pi --> WS["/workspace + tmux + MCP + git"]
    WS --> Egress[Egress proxy]
  end
```

图上的 `API Gateway` 是职责框，不是第四个进程。现网入口是 Caddy；鉴权 / 限流 / `/v1` 仍在 `control-plane` 的 `api` 模块。不要为了这个框再引入 Nginx，见 [nginx-research.md](./nginx-research.md)。

三层职责：

| 层 | 信任级 | 职责 |
| --- | --- | --- |
| 控制面 | 高（你的账号体系） | 鉴权、限流、Run 状态机、环境/Build、密钥、模型路由、SCM、事件扇出 |
| LLM Gateway | 高 | 唯一持有 Provider / GPU 凭证；计费、限流、审计、prompt cache |
| 执行面 VM | 低（按 Run 隔离） | 跑 pi、操作磁盘和进程、遵守 egress；只拿短寿命 JWT |

一次 Run 的主路径：

```mermaid
sequenceDiagram
  participant U as User
  participant API as api
  participant O as orchestrator
  participant R as Runtime
  participant W as neo-worker
  participant P as pi-coding-agent
  participant L as LLM Gateway

  U->>API: POST /v1/runs
  API->>O: create Run
  O->>R: provision(snapshot or JIT)
  R->>W: boot + inject JWT / certs
  W->>P: createAgentSession + prompt
  loop agent turn
    P->>L: stream (run JWT)
    L-->>P: tokens / tool calls
    P->>P: read / edit / bash on /workspace
    W->>API: RunEvent stream
    API-->>U: SSE
  end
  U->>API: follow-up
  API->>W: steer or follow_up
  W->>P: session.steer / followUp
```

---

## 4. 控制面

控制面是 **少数几个无状态进程** + 托管存储（MySQL 或 Postgres / Redis / 对象存储）。职责可以很多，Deployment 不要很多。

### 4.1 职责（先当模块，不要当仓库）

下表是控制面内部的职责边界。P0 除 LLM Gateway 外都进同一个 `control-plane` 进程；拆进程和拆仓库的规则见 [§14](#14-服务进程仓库三件不同的事)。

| 职责 | 干什么 | P0 部署在 |
| --- | --- | --- |
| `api` | 对外 REST / SSE。创建 Run、跟进、取消、拉 transcript、artifacts。请求限流（IP / 登录 / 用户写操作 / SSE 并发） | `control-plane` 模块 |
| `orchestrator` | Run 状态机；向 VM 调度器下发 provision / stop / snapshot | `control-plane` 模块 |
| `env` | Environment 版本、`environment.json`、密钥绑定、egress 策略 | `control-plane` 模块 |
| `build` | 后台 Build：clone + `install` + 打盘；维护 active / draft 快照 | `control-plane` 模块 |
| `llm-gateway` | 模型代理，OpenAI-compatible + 原生 Anthropic 透传。按 run JWT / org 做请求与并发限流 | **独立进程** |
| `scm` | GitHub App / GitLab；短寿命 clone/push token；开 PR | `control-plane` 模块 |
| `events` | 把 VM 上报的 AgentEvent 写成 RunEvent，SSE / WS 推给客户端 | `control-plane` 模块 |
| `artifacts` | 签上传 URL；文件直传对象存储 | `control-plane` 模块 |
| `scheduler` | 空闲回收、过期、warm pool 补货、定时 Build | `control-plane` 模块 |

### 4.2 Run 状态机

```
NOT_YET_STARTED
        │ provision
        ▼
   PROVISIONING ──► INSTALLING ──► RUNNING
                        │              │
                        │              ├── follow-up 仍在跑 → RUNNING
                        │              ├── 本轮结束等用户 → IDLE
                        │              ├── 子任务未完成 → WAITING_FOR_BACKGROUND_WORK
                        │              └── 失败 → ERROR
                        ▼
                   INSTALL_FAILED → ERROR

RUNNING / IDLE ──► ARCHIVED（用户结束）
               ──► EXPIRED（TTL / 磁盘回收）
```

槽位用尽时新 Run 停在 **NOT_YET_STARTED**，并记 `run.queued`；有空槽再 `provision`。不要把排队标成 ERROR。

和 Cursor 对齐的几个语义必须保留：

- **跟进队列**：用户在 RUNNING 时发的消息进入 queue；当前 turn 仍在跑时用 pi 的 `steer` 或 `followUp`，不要另起一个 Agent 进程。
- **当前正在执行的消息不再算 queued**。
- **IDLE** 表示本轮结束、会话还在，可以继续 prompt。`WORKER_RUNTIME=vm` 时 IDLE 超过 `WORKER_IDLE_RELEASE_MS`（默认 15 分钟）会先把工作区写回 host 再卸槽；有跟进再占槽恢复。`0` 关闭自动释放。
- **ARCHIVED / EXPIRED** 释放计算；transcript 按保留策略另存。

### 4.3 存储

| 存储 | 内容 |
| --- | --- |
| MySQL 或 Postgres | 用户、环境、Run 元数据、Build、PR 链接、事件索引。`DATABASE_URL` 以 `mysql://` / `mariadb://` 走 MySQL，`postgres://` 走 Postgres。现网 MySQL 在库机 `101.42.105.230`，操作见 [.cursor/skills/tencent-lighthouse-db/SKILL.md](../.cursor/skills/tencent-lighthouse-db/SKILL.md)。应用机域名 `neorun.cloud` 见 [production-domain.md](./production-domain.md) |
| Redis | 跟进队列、live event stream、lease / lock、warm pool 索引。现网 Redis 与 MySQL 同机 |
| 对象存储 | transcript 归档、artifacts、（可选）session JSONL 备份 |
| 密钥库 | SCM App 私钥、Provider Key、用户 secrets（KMS 加密） |
| 块存储 / 快照服务 | Environment Build 与 Run 磁盘快照 |

---

## 5. 执行面：VM 与 Worker

### 5.1 隔离单元

对外都叫 VM。对内用 `Runtime` 接口，方便换实现：

```
Runtime.provision(spec) → handle
Runtime.exec(handle, cmd)
Runtime.snapshot(handle) → snapshotId
Runtime.restore(snapshotId) → handle
Runtime.destroy(handle)
```

| 阶段 | 实现 | 用途 |
| --- | --- | --- |
| 开发 / 单机 | `WORKER_RUNTIME=local` 本机进程 | 迭代快，无隔离 |
| 小主机 / 现网轻量 | `WORKER_RUNTIME=vm`：有 `/dev/kvm` 走 Firecracker，否则 **loop 挂 ext4 槽** 再跑本地 worker | 4C/4G 用 2×4GiB 槽；不是真 VM |
| 容器 | `WORKER_RUNTIME=docker` | 一容器一 Run |
| 生产隔离 | Firecracker 或 Cloud Hypervisor | 硬件级隔离，启动秒级 |
| 加速 | 块设备 CoW 快照 + warm pool | 对标 Cursor Builds：新 Run 从热快照启动，而不是冷装 |

不要第一天就上 live-fork。先做「从成功 Build 的磁盘快照 boot」，再做「预热一台、clone 出多台」。Clone 方法先留在合约里：`reflink`（`cp --reflink=always`）→ 工作区 `copy` / 只读 rootfs `shared` → warm slot `rename`。

### 5.2 机器里有什么

```
/opt/neo/worker          neo-worker 守护进程（控制通道）
/usr/local/bin/pi        可选；生产用 SDK 嵌入，不走 CLI TUI
/workspace               仓库工作区（多仓时 /workspace/<name>）
/var/neo/sessions        pi SessionManager 的 JSONL
/var/neo/logs            setup / start / agent 日志
```

启动顺序：

1. 从 base image 或 **active Build 快照** boot
2. 注入 Run 身份：`runId`、短寿命 **control-plane mTLS cert**、**LLM Gateway JWT**、SCM token、secrets
3. 若不是 Build 启动：checkout 指定 ref，跑 `install`（必须可结束、可幂等）
4. 每次 boot 跑 `start`（Docker daemon、DB、tunnel）
5. 拉起 `terminals`（tmux 里的 dev server，agent 看得到日志）
6. 启动 `neo-worker` → 创建 `AgentSession` → 处理首条 prompt

`install` / `start` / `terminals` 的划分与 Cursor 相同，不能混：

| 字段 | 何时跑 | 放什么 |
| --- | --- | --- |
| `install` | Build 时，或冷启动时 | 装依赖、codegen、编译。必须退出。禁止在这里起长驻服务 |
| `start` | 每个 VM boot | 守护进程、Docker、恢复 ephemeral 状态。要幂等 |
| `terminals` | boot 之后 | 需要 agent 看见、能重启的前台进程 |

### 5.3 neo-worker

`neo-worker` 是 VM 内唯一和控制系统说话的进程。它**嵌入** pi，而不是让用户 SSH 进 TUI。

职责：

1. 维护到 orchestrator 的双向通道（gRPC 或 WebSocket + mTLS）
2. 用 SDK 创建 / 恢复 `AgentSession`
3. 把 pi 的 `AgentSessionEvent` 翻译成 `RunEvent` 上报
4. 接收 `prompt` / `steer` / `follow_up` / `abort` / `set_model`
5. 心跳、磁盘用量、egress 拒绝计数
6. 在策略允许时：commit、请求 scm-service 开 PR、上传 artifacts

**嵌入方式：优先 SDK，RPC 作备选。**

| 方式 | 何时用 |
| --- | --- |
| `createAgentSession()` 同进程 | TypeScript worker。类型安全，能改 `streamFn`、工具、extensions |
| `pi --mode rpc` JSONL stdin/stdout | Worker 是 Go / Rust。用 LF 分帧，不要用 Node `readline`（它会按 Unicode 分隔符切行） |

SDK 骨架：

```typescript
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create({
  credentials: inMemoryStore, // 禁止把 Provider Key 写到 VM 磁盘
});
await modelRuntime.setRuntimeApiKey("neo-gateway", runJwt);

const { session } = await createAgentSession({
  cwd: "/workspace",
  sessionManager: SessionManager.open(`/var/neo/sessions/${runId}.jsonl`),
  modelRuntime,
  model: gatewayModel, // api: "openai-completions", baseUrl: LLM_GATEWAY_URL
  tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
});

session.subscribe((event) => controlChannel.send(toRunEvent(event)));
await session.prompt(firstUserMessage);

// 用户跟进
channel.on("follow_up", (text) => session.followUp(text));
channel.on("steer", (text) => session.steer(text));
```

`streamFn` 可再包一层，加上 `X-Neo-Run-Id`、超时和重试。密钥仍然只出现在 Gateway。

### 5.4 网络

VM **没有**公网入站。出站全部经过 egress proxy：

| 模式 | 行为 |
| --- | --- |
| allow-all | 开发默认 |
| default + allowlist | 系统域名（Gateway、SCM、npm 等）+ 用户名单 |
| allowlist-only | 仅名单；Gateway / SCM 仍放行，否则 Run 无法推理或 push |

控制面在 clone / 开 PR 前用同一套 `evaluateEgress` 拦远程 host；worker 给 `fetch` 加同样的守卫，并上报 `egress.denied`。这是应用层执行，还不是 VM 出站 iptables。

Git 走独立 **git egress proxy**（固定出口 IP），方便客户做 IP allowlist。Artifacts 只允许精确 bucket host，禁止 `*.s3.amazonaws.com` 这种会变成数据外带通道的通配。

---

## 6. 为什么内核是 pi，以及怎么用

pi 的分层正好对应我们要外包和要自建的边界：

```
neo-worker / 云扩展          ← 你写：控制通道、Git/PR、MCP、egress 感知
        │
pi-coding-agent              ← 会话、read/write/edit/bash、skills、extensions、compaction
        │
pi-agent-core                ← loop、tool execution、steer/followUp、事件
        │
pi-ai                        ← 多 Provider 流式、用量、自定义 baseUrl
```

### 6.1 直接复用

- Agent loop、工具执行、streaming 事件
- `steer` / `followUp`（对标云端跟进队列）
- `SessionManager` JSONL（可分支、可恢复）
- `compact()` 与自动重试
- Extensions / Skills / Prompt Templates（团队能力用包分发，不改 fork pi）
- `ModelRuntime` + `InMemoryCredentialStore`（运行时 JWT，不落盘）

### 6.2 你们必须自建（pi 不管）

- VM 供给、快照、warm pool
- 多租户鉴权、配额
- LLM Gateway 与账单
- SCM / PR
- 环境 Builds
- 客户端与 transcript 存储
- Egress、密钥分级、审计
- 跨 Run 的用户 / 项目语义记忆（旁路服务，不进 VM；选型见 [agent-memory-research.md](./agent-memory-research.md)）

### 6.3 云扩展（pi Package，装在 VM 镜像里）

用 `pi.registerTool` / hooks，不要改 pi 源码：

| 扩展 | 作用 |
| --- | --- |
| `neo-git` | `neo_git_commit` → `POST /internal/runs/:id/scm/commit`；签名和 push 走控制面，不把长期 token 给 bash |
| `neo-pr` | `neo_pr_open` → `POST /internal/runs/:id/scm/pull-request` |
| `neo-mcp` | `neo_mcp_list` / `neo_mcp_call`：读工作区 `.neo/environment.json` 的 `mcp`。HTTP 先走控制面 `/internal/runs/:id/mcp`（Bearer / OAuth 密钥不进 worker），失败再直连；stdio 仍在 worker |
| `neo-browser` | `neo_browse`：抓公开 http(s) 页的 title + 可见文本。**不是** headed browser / computer-use |
| `neo-artifact` | `neo_artifact_upload`：把工作区文件传到 `POST /internal/runs/:id/artifacts`，对话页用 `/v1/runs/:id/artifacts/:name` 下载或预览。录屏 / 远程桌面未做 |
| `neo-diag` | `neo_diag` 读 `GET /internal/runs/:id/diagnostics` 和工作区 `.neo/logs` |
| `neo-subagent` | `neo_subagent`：worker 内嵌套 session，不占第二槽，也不把 loop 打回控制面 |
| `neo-subscribe` | `neo_subscribe` → `POST /internal/runs/:id/subscriptions`；GitHub 评论 / Actions 经 `POST /webhooks/github` 进跟进队列 |
| `neo-memory` | `neo_memory_add` / `neo_memory_search` → `POST /internal/runs/:id/memories`；按 run.userId 写/搜 Mem0，密钥不进 worker |

策略类拦截（禁止 `curl` 外带、禁止读 `/opt/neo/worker` 证书）用 extension 的 tool hook，而不是改 `bash` 实现。工作区 `.cursor/hooks.json` / `.neo/hooks.json` 的 command hooks（`preToolUse`、`beforeShellExecution`、`afterFileEdit`、`stop`）走 pi 的 inline `tool_call` 钩子；**不**加载宿主机 `~/.cursor/hooks.json` 或 pi host extensions。

### 6.4 系统提示

worker 用 **workspace loader**：读工作区 `AGENTS.md` / `CLAUDE.md`，以及 `.pi/skills`、`.cursor/skills`、`.claude/skills`、`.codex/skills`、`.neo/skills`、`.agents/skills`。仍然 **不** 加载宿主机 `~/.pi` / `~/.cursor` 的 skills 或 extensions。云端系统提示继续注入（工作区路径、分支命名、禁止交互式 sudo、用 `neo_*` 而不是自己 `git push`）。本机再跑一份 pi TUI 是另一个产品，不要和云端 `neo run` 混语义。

---

## 7. LLM Gateway

Gateway 是「推理在云端」的落点。VM 把它当成一个 OpenAI-compatible（或 Anthropic-compatible）的 `baseUrl`。

```
pi-ai streamSimple
    → https://llm.<cluster>/v1/chat/completions
    → Authorization: Bearer <run JWT>
    → Gateway: 验 JWT、限流、配额、选路由、打点
    → Provider SDK / 内部 vLLM
```

必须具备：

1. **Run-scoped JWT**：`runId`、`orgId`、`model`、过期时间；VM 重启就轮换
2. **模型目录**：对外稳定 id（`neo/deepseek`、`neo/sonnet`），对内映射到 DeepSeek / Claude / GPT / 自建
3. **Prompt cache**：把 pi 的 `sessionId` 映射到 Anthropic cache / OpenAI cached input
4. **用量**：input / output / cache read-write，按 Run 聚合
5. **审计**：可选存 prompt/response（隐私模式关闭）；隐私模式只存 token 计数
6. **熔断**：Provider 挂了按策略换模型，并写成 RunEvent
7. **自建推理**：同一接口后面可以是 vLLM / SGLang，不必改 worker

Gateway **不**执行工具，**不**看见整个磁盘。它只看见 pi 送出的 messages + tool schemas。

---

## 8. 环境与 Builds

环境是「这台开发机应该长什么样」，Run 是「在某个环境版本上执行一次任务」。

### 8.1 配置源（优先级从高到低）

1. 仓库 `.neo/environment.json`（或兼容读取 `.cursor/environment.json`）
2. 用户保存的 Environment
3. 团队默认 Environment

`environmentJsonPath` 有值 = repo-managed；为空 = DB-managed。不要两种同时改还指望合并。

### 8.2 Schema（核心字段）

```json
{
  "snapshot": "snap_base_ubuntu_node22",
  "install": "pnpm install --frozen-lockfile",
  "start": "sudo dockerd >/var/neo/logs/docker.log 2>&1 &",
  "terminals": [
    { "name": "web", "command": "pnpm dev" }
  ],
  "repos": ["github.com/acme/app", "github.com/acme/lib"],
  "egress": { "mode": "allowlist", "domains": ["registry.npmjs.org"] }
}
```

### 8.3 Build 流水线

```
trigger (保存环境 / 定时 / 手动 / agent 请求)
    → 从 base snapshot 开一台 Build VM
    → clone 环境内每个 repo 的 default branch（或 refs 覆盖）
    → 跑 install 至结束
    → 打盘 → snapshotId
    → SUCCEEDED 的 latest 标为 active（draft 永不自动激活）
    → warm pool 按 active 预热 N 台
```

新 Run：

1. 有 active Build：从快照（或热机器 fork）启动，**不再跑 install**
2. 没有：JIT：base + clone + install（慢，仅兜底）

失败的新 Build 不影响正在用的 active。这是 fleets 能扛住「有人提交了坏 lockfile」的原因。

用户 secrets **不**进 Build；只有 build secrets（私有 npm）进。Runtime secrets 在 agent boot 时注入，并在 transcript / 工具输出里打码。

---

## 9. 会话、跟进、事件

### 9.1 两份日志

| 日志 | 位置 | 用途 |
| --- | --- | --- |
| pi session JSONL | VM `/var/neo/sessions/<runId>.jsonl` | pi 恢复上下文、compaction、树分叉 |
| RunEvent / transcript | 控制面（Redis 热、对象存储冷） | UI、审计、跨设备打开 |

worker 在 `message_end` / `tool_execution_end` / `agent_end` 时把规范化事件推上去。不要让 UI 直接读 VM 磁盘。

### 9.2 跟进如何接到 pi

| 用户动作 | 控制面 | worker → pi |
| --- | --- | --- |
| Run 空闲时发消息 | 直接下发 | `session.prompt(text)` |
| Run 正在流式，用户要改方向 | 标记 steer | `session.steer(text)` 或 `prompt(..., { streamingBehavior: "steer" })` |
| Run 正在流式，用户要「做完再做」 | 入 follow-up 队列 | `session.followUp(text)` |
| 取消 | abort | `session.abort()` |

这和 pi SDK 的语义一一对应，不要再写第二套队列执行器。控制面队列只解决：**VM 还没 ready、或 worker 暂时断线时把用户消息存住**。

### 9.3 事件（给 UI / 仪表盘）

规范化事件见 `packages/contracts` 的 `RunEvent`。已覆盖：

- 生命周期：`run.provisioning` / `run.install_*` / `run.start_*` / `run.terminal_*` / `run.running` / `run.queued` / `run.idle` / `run.error` / `run.archived`
- Agent：`agent.start` / `agent.end` / `message.start` / `message.delta` / `message.end` / `tool.start` / `tool.update` / `tool.end` / `user.message` / `llm.usage`
- SCM：`scm.clone_*` / `scm.branch_*` / `scm.commit_*` / `scm.push_*` / `scm.pr_*`
- 系统：`mcp.auth_error`、`egress.denied`、`build.used`、`followup.queued` / `followup.delivered`、`artifact.uploaded`

`GET /v1/runs/:id/transcript` 用 `buildTranscriptSnapshot` 把事件收成消息。同一轮里：`message.end` 之后的工具单独成组，下一句模型文字再开一条气泡。对话页按 `transcriptGroups` 渲染——**工具调研在最终答复上面**，不再整段回复底下挂一排工具卡。worker 给每条事件打 `data.workerSeq` 并串行 POST；快照按 `workerSeq` / `createdAt` 还原顺序，避免 HTTP 乱序把工具挤到回复后面。

对话页（`packages/web`，React）还提供：Markdown 流式渲染、文件 diff、工作区文件树（`GET /v1/runs/:id/fs`）、沙箱终端（`/v1/runs/:id/term`，`script` PTY，按键直送、Tab 补全路径）、粘贴图片（最多 4 张，worker 落到 `.neo/inbox-images/`）、token 用量、归档、DeepSeek Flash / Pro 选择。不要从浏览器 import `@neo-cloud-agent/contracts` 主桶，只用 `./transcript`、`./events`、`./run`。

---

## 10. SCM 与交付

```
创建 Run
  → scm-service 用 GitHub App 签短寿命 token
  → VM clone（Build 已带代码则 fetch + checkout）
  → neo-worker 建分支  neo/<slug>-<shortid>
  → agent 改代码、自测
  → 受控 git commit（可选 HSM / 服务端签名）
  → push
  → scm-service 开 draft PR，正文由 agent 写，元数据由控制面附加
```

原则：

- 长期 SCM 凭证不过 VM 磁盘、不进环境变量明文（用文件描述符或 localhost token broker，用完即废）
- 用户在 UI 上看到的 diff 以 `git diff` + 控制面缓存为准
- 多仓环境：每个被改的 repo 各自开 PR，Run 上记一组 `PullRequestRef`

---

## 11. 安全模型

假设 VM 会被 prompt injection 拿下。设计按这个前提做。

| 威胁 | 对策 |
| --- | --- |
| 偷 Provider Key | Key 只在 Gateway；VM 只有 JWT |
| 外带源代码 | Egress allowlist；禁止宽泛 S3 wildcard；git 只走 proxy |
| 密钥进 transcript / commit | Runtime secret 在工具输出和 git hook 里替换为 `[REDACTED]` |
| 逃逸到宿主机 | Firecracker + jailer；每个 Run 独立网桥和盘 |
| 横向访问其他 Run | 控制通道按 `runId` 鉴权；对象存储路径隔离 |
| 供应链 | Worker 与 pi 版本钉死在镜像；extensions 只装签名/内部 registry |
| 身份冒用云资源 | 短寿命 OIDC（VM 本地 socket 签发），不要长期云 AK |

密钥分三级，对齐 Cursor：

1. **Environment variable**：agent 可以看见（feature flag、公共 URL）
2. **Runtime secret**：进程环境里有，模型看见的输出被打码
3. **Build secret**：只在 Build 的 `install` / Docker build，不进正式 Run

---

## 12. 核心数据模型

```
Org 1──* Environment 1──* EnvironmentVersion 1──* Build
                                              └── snapshotId, status
User 1──* Run
Run
  id, orgId, envId, envVersionId, buildId?
  status, setupStatus
  source: web | cli | slack | github | api | automation | telegram | wechat | desk | ios | android
  model, branchName, repoUrls[]
  workerHandle, llmJwtJti
  createdAt, idleAt, expiresAt
Run 1──* FollowUp (queued | delivered | cancelled)
Run 1──* RunEvent
Run 1──* Artifact
Run 1──* PullRequestRef
```

`Build.status`: `IN_PROGRESS | SUCCEEDED | FAILED | CANCELLED | SKIPPED`  
`Run.setupStatus`: `INSTALL_STARTED | INSTALL_SUCCEEDED | INSTALL_FAILED | START_STARTED | START_SUCCEEDED | START_FAILED | null`

---

## 13. 对外 API（最小集）

```
POST   /v1/auth/login|logout
GET    /v1/me
GET    /v1/vms
GET    /v1/rate-limits
GET    /v1/settings/llm
POST   /v1/settings/llm          页面存 Key；响应永不回传明文

POST   /v1/devices               登记手机推送 token（Expo）
GET    /v1/devices
DELETE /v1/devices/:id

POST   /v1/runs                  创建并开始（槽满则 queued）
GET    /v1/runs
GET    /v1/runs/:id
POST   /v1/runs/:id/follow-ups   空闲 prompt / 运行中 steer|follow_up
POST   /v1/runs/:id/abort
POST   /v1/runs/:id/archive
GET    /v1/runs/:id/events       SSE（多端订阅；`id` + `after` / `Last-Event-ID` 续订）
GET    /v1/runs/:id/transcript   原始事件 + 压缩 snapshot
GET    /v1/runs/:id/fs           工作区文件树；`?content=1` 读文件（限制在工作区内）
GET|POST /v1/runs/:id/term       沙箱工作区 PTY shell（`script`，无则管道）；本机 Desk 对话 409
GET    /v1/runs/:id/term/:id/events
POST|DELETE /v1/runs/:id/term/:id
GET    /v1/runs/:id/diff
GET    /v1/runs/:id/diagnostics
GET    /v1/runs/:id/artifacts
GET    /v1/runs/:id/artifacts/:name
POST   /v1/runs/:id/commit
POST   /v1/runs/:id/pull-request

GET    /v1/environments
POST   /v1/environments
GET    /v1/environments/:id
POST   /v1/environments/:id/builds
GET    /v1/environments/:id/builds
POST   /v1/builds
GET    /v1/builds
GET    /v1/builds/:id
GET    /v1/builds/:id/logs
```

第一个非 Web 宿主是 `packages/cli`（`pnpm neo`）。它只消费上面这组 `/v1` 和 SSE，`source` 填 `"cli"`。协议、退出码和明确不做的本机 Agent / worker 桥见 [cli.md](./cli.md)。iOS / Android 是下一个同级宿主：同样只打 `/v1`，不在手机上跑 loop；方案见 [mobile.md](./mobile.md)。

内部通道是 **HTTP `/internal/runs/:id/...`**（worker 带 run JWT），不是单独的 gRPC 服务：

```
GET  /internal/runs/:id/bootstrap
POST /internal/runs/:id/inbox          控制面 → worker（prompt / steer / follow_up / abort / shutdown）
POST /internal/runs/:id/events         worker → 控制面
GET|POST /internal/runs/:id/session
POST /internal/runs/:id/egress-check
GET  /internal/runs/:id/diagnostics
POST /internal/runs/:id/scm/commit
POST /internal/runs/:id/scm/pull-request
POST /internal/runs/:id/scm/token
POST /internal/runs/:id/artifacts
```

---

## 14. 服务、进程、仓库：三件不同的事

**模块 ≠ 进程 ≠ 仓库。** 上一节列的 `env-service` / `scm-service` 是职责边界，不是「开 8 个 GitHub repo、8 个 Deployment」。

| 概念 | 数量（P0） | 数量（成熟期） | 是什么 |
| --- | --- | --- | --- |
| Git 仓库 | **1** | 1，偶尔 2 | 代码怎么管 |
| 可部署进程 | **2 + worker 镜像** | 3～4 + worker 镜像 | 运行时怎么扩 |
| 逻辑模块 | 4～6 个 package | 8～10 个 package | 代码怎么分层 |

### 14.1 用一个 monorepo

就用本仓库 `neo-cloud-agent`。pnpm / npm workspaces 管 package。

理由：

1. **合约会一起变。** `RunEvent`、Worker RPC、LLM JWT 一改，api / gateway / worker 必须同 PR 升级，多仓会先出现协议漂移。
2. **worker 不是独立产品。** 它随控制面版本发布，打进 VM 镜像；单独仓库只会让「控制面 v12 配 worker v7」成为常态。
3. **pi 本身就是 monorepo。** 你们的差异化在编排，不在再发明一套跨仓发布。

不要为「微服务干净」拆仓。以后只有两类东西才值得考虑第二个仓库：

| 第二个仓 | 何时才拆 | 为什么 |
| --- | --- | --- |
| `neo-vm-images` | 镜像构建（Packer / Firecracker rootfs）把应用 CI 拖到 30 分钟以上 | 构建节奏和权限与应用不同 |
| 公开 extension 注册表 | 第三方要独立发 pi package | 那是生态，不是内核 |

**永远不要拆出去的：** `packages/contracts`。它是协议，不是服务。

### 14.2 可部署进程只要这些

控制面里的「服务」先当 **同一个进程里的模块**。真正需要单独进程的，只有密钥边界和重活。

```
P0（先上这 3 个部署物）

  ┌─────────────────────────────┐
  │  control-plane  (1 进程)    │  api + orchestrator + env + events
  │                             │  + scm + artifacts + scheduler（都是模块）
  └──────────────┬──────────────┘
                 │
  ┌──────────────┴──────────────┐
  │  llm-gateway  (1 进程)      │  唯一持有 Provider Key；独立扩缩、独立审计
  └─────────────────────────────┘

  ┌─────────────────────────────┐
  │  worker 镜像                │  不是集群里的长驻服务
  │  neo-worker + pi + 扩展     │  每个 Run 起一份，随 VM 生灭
  └─────────────────────────────┘
```

| 部署物 | 为什么独立 | 为什么不要再拆 |
| --- | --- | --- |
| `control-plane` | 对外 API、状态机、调度 | env / scm / event 此时是函数调用，不是网络 hop |
| `llm-gateway` | **密钥隔离** + 按 token 扩缩 + 审计面单独 | 这是唯一值得 P0 就拆进程的服务 |
| `worker` 镜像 | 跑在不可信 VM，攻击面不同 | 每个 Run 一份，不要做成集群 Deployment |

P2 以后，**最多再拆 1 个进程**：

| 部署物 | 何时拆出去 | 信号 |
| --- | --- | --- |
| `build-worker` | Build 开始抢 control-plane CPU / 磁盘 | `install` 跑十几分钟、队列堵了创建 Run |

再往后才考虑把 webhook 量大的 `scm-ingress` 或对象上传的 `artifact-service` 拆出去。那是流量问题，不是架构正确性问题。

**不要做成独立进程的：** MySQL / Postgres、Redis、对象存储用托管。egress proxy / git proxy 是基础设施（Envoy / squid / 自建小代理），不是业务仓库。

### 14.3 monorepo 目录（模块，不是服务）

```
neo-cloud-agent/                  ← 唯一应用仓库
  docs/
  packages/
    contracts/                    类型与协议（被所有进程 import）
    control-plane/                打成一个二进制 / 一个容器
      src/api/
      src/orchestrator/
      src/env/
      src/scm/
      src/events/
      src/runtime/                Docker 先，Firecracker 后
    llm-gateway/                  打成第二个容器
    worker/                       打进 VM / 任务容器镜像
    extensions/                   打进同一张 worker 镜像
    cli/                          终端客户端（不是第四个进程）
    mobile/                       手机客户端，见 [mobile.md](./mobile.md)
  infra/                          compose、helm、镜像配方（先放这里）
  .neo/environment.json
```

控制面仍是四个运行时 package：`contracts`、`control-plane`、`llm-gateway`、`worker`。`packages/cli` 是第五个 **客户端** package，不部署成进程。iOS / Android 以后是第六个客户端 package，同样不是 Deployment。`orchestrator` / `scm` 是 `control-plane` 的目录，不是新仓库，也不是新 Deployment。

### 14.4 和「微服务清单」的对照

| 架构里的职责 | P0 落在哪 | 以后 |
| --- | --- | --- |
| api | `control-plane` 模块 | 仍在这里 |
| orchestrator | `control-plane` 模块 | 仍在这里 |
| env-service | `control-plane` 模块 | 仍在这里 |
| event-service | `control-plane` + Redis | 仍在这里 |
| scm-service | `control-plane` 模块 | webhook 爆炸再拆 ingress |
| artifact-service | `control-plane` 签 URL，上传直传对象存储 | 几乎永远不必成服务 |
| scheduler | `control-plane` 里的 cron 协程 | 仍在这里 |
| build-service | `control-plane` 模块（快照 + warm pool） | 变重再拆 `build-worker` |
| llm-gateway | **独立进程** | 一直独立 |
| neo-worker | **镜像，不是服务** | 一直是镜像 |

### 14.5 版本怎么发

一个 git SHA 产出三件东西，一起打 tag（例如 `2026.08.21+2e5ceab`）：

1. `control-plane` 镜像
2. `llm-gateway` 镜像
3. `worker` 镜像（或 Firecracker rootfs）

Orchestrator 创建 Run 时写下 `workerImageDigest`。不要让「控制面最新、worker 随便」组合上线。合约变更必须同版本滚动。

---

## 15. 分阶段落地

按依赖排序，不按日历估时。

### P0 — 能跑通一个任务

- 仍是 **1 个仓库**；只发 **2 个控制面容器 + 1 张 worker 镜像**
- Docker Runtime：一容器 = 一 Run（`WORKER_RUNTIME=docker`）；开发可切 `local` 本机进程
- `packages/worker` 嵌入 `createAgentSession`
- `packages/llm-gateway`（先只接一个 Provider，JWT 鉴权）
- `packages/control-plane`：`POST /v1/runs` + SSE，并托管 `packages/web` 对话页
- 控制面把 `repoUrls` 落到 Run 工作区（本地目录拷贝，或公开 git clone）；不做 PR

验收：对一个玩具仓库说「加个 README 并跑测试」，UI 能流式看到 bash / edit。

### P1 — 像云端 Agent

- SCM clone + 分支 + commit + draft PR
- 跟进队列 ↔ `steer` / `followUp`
- `environment.json` 的 `install` / `start` / `terminals`
- Secrets + transcript 打码
- Session JSONL 备份到对象存储，IDLE 后可恢复

### P2 — 像 Cursor 的环境系统

- Build 流水线 + 磁盘快照 + active/draft（控制面已落地：JIT install 后打盘，新 Run 复用；draft 永不自动激活）
- Warm pool（已落地：成功 Build 的工作区副本，reflink 优先；还不是 live-fork 一台正在跑的 VM）
- Firecracker guest init / rootfs overlay（已落地配方；生产盘仍要内核 + 烤进 worker 的 ext4）
- Egress 三模式（已落地应用层）
- MCP / browse / artifacts（已落地 HTTP MCP 控制面代理 + OAuth/Bearer、`neo_browse`、签名 artifact 链到 PR；headed 桌面未做。怎么补 browser-use / computer-use 见 [browser-computer-use.md](./browser-computer-use.md)）

### P3 — 生产隔离与规模

- Firecracker / Cloud Hypervisor live-fork（正在跑的 VM 热分叉）
- 失败 Build 不影响 fleets
- 多仓、Slack / Linear、OIDC。GitHub PR 评论 + Actions 订阅已落地：`neo_subscribe` + `POST /webhooks/github`（HMAC），开 PR 会自动订阅。CI 失败默认 autofix（最多 3 次）；人跟进或人 push 分支后停。对话页可建每天 / 每小时任务（`source: automation`）。Telegram / 微信公众号发一句开新对话；做完或 PR 开好了可推企业微信、Telegram、HTTP 或 SMTP。`QUOTA_MAX_*` / 设置页限制同时跑的对话和本月 token。
- 子 Agent：已落地 `neo_subagent`。契约对齐 pi 官方 `subagent` 扩展（scout / planner / reviewer / worker，single / parallel / chain，`.pi/agents/*.md`）。实现走 worker 内二次 `createAgentSession`，不 spawn `pi` CLI，也不把 loop 打回控制面。子会话的 `agent.end` 不会把父 Run 标成 IDLE。子工具事件收进父卡片的 `details.steps`，不在 transcript 里铺成平级卡片。scout 用 `neo_browse` 做公开网页，不再带 bash。

---

## 16. 与 Cursor Cloud Agent 的对照

| Cursor | Neo | 实现要点 |
| --- | --- | --- |
| 隔离 Linux VM | Execution Runtime | 现网轻量走 loop 槽（`WORKER_RUNTIME=vm`）；Docker / Firecracker 可选 |
| `.cursor/environment.json` | `.neo/environment.json` | 字段兼容，便于迁移 |
| Builds + warm fork | `build-service` + snapshot | 先冷快照，后热 fork |
| 模型在云端 | LLM Gateway | VM 无 Provider Key |
| 跟进队列 | Redis + pi `steer`/`followUp` | 不要自研第二套 loop |
| Subagents / Task | `neo_subagent` | 对齐 pi 官方 subagent 契约；SDK 嵌套 session，不用 `pi --mode json` |
| Cloud MCP | `neo-diag` extension | 动态工具，不必改 pi |
| MCP / Hooks | 工作区 skills / `AGENTS.md` + `.cursor/hooks.json` command hooks | 不加载宿主机 `~/.pi` extensions |
| GitHub PR / CI 订阅 | `neo_subscribe` + `/webhooks/github` | 开 PR 自动订阅；CI 失败 autofix 到绿 |
| 用户记忆 | `neo_memory_add` / `neo_memory_search` + `/v1/memories` | 控制面代理 Mem0；独立记忆页看/记/改/删；密钥不上 VM |
| Artifacts / 远程桌面 | 签名 `/v1/runs/:id/artifacts/:name?token=` | 桌面可后置；分期见 [browser-computer-use.md](./browser-computer-use.md) |
| GitHub / Slack / API | `api` + `scm` + 适配器 | GitHub webhook 已落地；Telegram / 微信公众号可开对话 |
| Cursor CLI / `-p` / Cloud API | `packages/cli`（`neo`） | 只做 Cloud 客户端，不复刻本机 `agent` |
| 手机查看 / 跟进 | `packages/mobile` | Expo 壳 + `/v1`；新开只 cloud，列表含 Desk Remote。见 [mobile.md](./mobile.md) |
| Agent 内核（自研） | **pi-coding-agent** | 这是唯一故意不对齐的地方 |

不对齐是优点：pi 已经有 SDK、RPC、session、extensions。你们的差异化在 **编排、环境和安全**，不在再写一遍 tool loop。

---

## 17. 明确不做什么

1. **不要 fork pi 来加云功能。** 云功能全部走 worker + extension。
2. **不要把 Provider Key 写进 VM 的 `auth.json`。** 只用 `InMemoryCredentialStore` + 运行时 JWT。
3. **不要在 `install` 里起 dev server。** 快照不会保存进程。
4. **不要让 bash 直接 `git push` 带长期 token。** push 经 scm-service。
5. **不要为了「推理在云端」把 Agent 放控制面。** 推理走 Gateway 即可。

---

## 18. 建议的下一步实现顺序

P0 主路径已经通了。Firecracker Runtime、Redis 热流、MySQL / Postgres 元数据、用户账号、以及 Environment Builds / warm pool 已经落地（没配服务时仍回退到本机文件 / 内存）。下一刀仍在本 monorepo：

1. Firecracker 生产 rootfs / tap 回连已经落地（`pnpm fc:assets` / `pnpm fc:rootfs` / `pnpm test:firecracker`）。嵌套 KVM + AMX 的宿主机 `KVM_CREATE_VCPU` 会故障，live turn 需在真机或非 AMX 宿主上跑。
2. 块设备 CoW 已落地接口：Build / 预热 / Firecracker rootfs 先 `cp --reflink=always`；文件系统不支持时工作区整树复制，生产 rootfs 只读共享原盘（不整份拷 1.5GiB）。不是 live-fork。
3. 配额：同时跑的对话 / 本月 token 已落地（`GET /v1/quota`）；完整账务仍后置。请求限流已落地：控制面按 IP / 登录 / 用户写操作 / SSE 并发，Gateway 按 run JWT 与 org；`GET /v1/rate-limits` 看当前桶。设了 `REDIS_URL` 后计数走 Redis 固定窗口，否则进程内 token bucket。`RATE_LIMIT=0` 关闭。后管与模型网关怎么拆（New API 管渠道、Neo 管 Agent 用户）见 [admin-platform-research.md](./admin-platform-research.md)。
4. Egress 从应用层升级到 VM 出站代理 / iptables
5. headed browser / computer-use sidecar（`neo_browse` 只抓静态页）。**先做 Playwright a11y browser-use，桌面和远程接管后置**，见 [browser-computer-use.md](./browser-computer-use.md)
6. CLI 交互 TUI、浏览器登录、本机 pi 模式——都单开，不要和 `neo run` 混语义。P0 headless 客户端见 [cli.md](./cli.md)
7. iOS / Android：与 CLI 同级的 `/v1` 宿主，不在手机上跑 loop。先 HTTPS 域名和设备推送，再开 `packages/mobile`。方案见 [mobile.md](./mobile.md)

控制面重启后续上 RUNNING Worker、以及对外 API 令牌鉴权已经落地。

已落地的约定：

- 多端流式是订阅制：Worker 只生产一次，客户端（多个标签 / 设备）都订控制面 `GET /v1/runs/:id/events`。晚到的端先拿 transcript snapshot，再带 `after` / `Last-Event-ID` 跟直播。
- transcript / session 会再写一份到对象存储（默认 `RUNS_DIR/.objects`，可换 S3）。本地 `.control` 丢了还能从归档恢复。
- `start` 失败默认不阻断 Agent（和 Cursor 一样，只记 `START_FAILED`）。`environment.json` 里 `startMustSucceed: true` 或 `START_MUST_SUCCEED=1` 才会让 worker 退出、Run 变 ERROR。
- 控制面用 GitHub App 安装令牌做 push / 开 PR；没配 App 时回退 PAT。Worker 只拿 `neo.git.*`。
- 控制面重启后会认领还在的 local pid / docker 容器；认领不到就等 worker 心跳。已经挂上的 handle 以进程/容器退出为准，不会因为一次长工具调用没心跳就被标 ERROR。超时才标 ERROR，之后 follow-up 仍可从 session 恢复。
- 对外 `/v1` 用用户 session（`POST /v1/auth/login`，用户名或手机号）或 `CONTROL_PLANE_TOKEN`。`POST /v1/auth/register` 用手机号注册（另需用户名和密码，无验证码，手机号唯一）；注册后 `pending`，管理员在 `/admin/` 通过后才能登录，起步额度 ¥5（`users.credit_fen`）。默认必须登录（`ACCOUNTS_REQUIRED=0` 才允许匿名）。默认管理员仍是 `admin` / `123456`，登录时查账号库（接了 MySQL 就查 `users` 表）。对话页不预填、不跳过。Worker 走 `/internal`，只带 run JWT。`/health`、静态页和公开 webhook 不需要令牌。
- 平台管理台是独立应用，不嵌进对话页：`packages/admin-api`（默认 `:8090`）+ `packages/admin-web`（默认 `:5176`，`pnpm dev:admin`）。现网同一域名路径：`https://neorun.cloud/` 对话、`https://neorun.cloud/admin/` 管理台。只认 `admin` / `ADMIN_EMAILS` / 服务令牌。读同一套账号库和持久化 Run，不改控制面 `/v1` 登录。New API 只做控制台链接。
- 设了 `DATABASE_URL` 后，Run / 事件 / 用户 / Environment / Build 写入 MySQL 或 Postgres（看 URL scheme）；没配则继续用 `.control` JSON。
- 设了 `REDIS_URL` 后，直播事件走 Redis Pub/Sub + Stream；没配则仍是进程内 EventEmitter。多个控制面进程订同一条 Run 流。限流计数也复用这条 Redis（`INCR` 固定窗口）；没配则进程内 token bucket。
- 对外 `/v1` 与 `/webhooks/*` 默认限流：IP、登录（含账号）、用户/组织读写、贵操作（Build / 设置 / commit / PR）、SSE 并发。`/health`、静态页、`/internal` 不限。Gateway `POST /v1/chat/completions` 按 run JWT 与 org 限 QPS 和在飞请求。超限返回 `429` + `Retry-After` / `X-RateLimit-*`。`GET /v1/rate-limits` 看当前桶。`RATE_LIMIT=0` 关闭。
- `WORKER_RUNTIME=firecracker` 走 Firecracker HTTP API（kernel / rootfs / tap / vsock）。开发机没配内核时继续用 local / docker。没配 `FIRECRACKER_ROOTFS` 时：若 `infra/firecracker/.assets/rootfs.ext4` 是生产盘（`pnpm fc:rootfs`）就用它，否则用 overlay 打一张小 ext4（单测路径，需要 `mkfs.ext4`）。Guest 不能用 `127.0.0.1` 回连宿主机，provision 会把控制面 / Gateway URL 改成 tap 宿主机 IP。
- Environment Builds：`POST /v1/environments`、`POST /v1/builds`。成功的非 draft Build 成为同一 fingerprint 的 active 快照；新 Run 先 claim warm slot（`rename`），否则 reflink / 拷贝 snapshot，不再跑 `install`。`BUILD_CAPTURE=0` 关闭 JIT 打盘；`WARM_POOL_SIZE` 默认 1。对话页可以选环境 / 快照，或点「预热」。
- Egress：`environment.json` 的 `egress.mode` 会进 worker（`NEO_EGRESS_*`）。`allowlist_only` 拦 clone 和不在名单里的 `fetch`；Gateway / GitHub 仍放行。
- Worker 把 `neo_git_commit` / `neo_pr_open` / `neo_diag` / `neo_browse` / `neo_mcp_*` / `neo_artifact_upload` 注册成 pi `customTools`。Agent 用它们走控制面 commit / 开草稿 PR / 看 setup 与 egress / 抓网页 / 调 MCP / 上传产物；不要让 bash 拿长期 git token。`GET /v1/runs/:id/diagnostics` 给 UI，worker 走 `/internal`。
- `packages/cli` 是 `/v1` 的 headless 宿主：创建 Run（`source: "cli"`）、订 SSE、跟进 / 归档 / diff / PR。不在终端里跑 pi，不持有 Provider Key。
- DeepSeek：`deepseek-v4-flash` 是默认便宜模型；`deepseek-chat` / `deepseek-reasoner` 已退役，读写设置时改写成 flash。`deepseek-v4-pro` 显式保留。对话页可以切 Flash / Pro。
- `WORKER_RUNTIME=vm`：无 KVM 时用 loop ext4 槽。空闲超时先把工作区写回 `hostRunsDir/<runId>` 再 `releaseVmSlot`（卸槽会擦盘）。写回失败则留下槽。工作区有全站预算和 TTL 回收，见 [workspace-persistence.md](./workspace-persistence.md)。两槽都忙则新对话 `run.queued`。loop/local worker 套 `WORKER_MEMORY_MIB` 堆上限；control-plane 有 cgroup `Delegate=` 时再套 RSS。归档 / 过期 run 不把事件树留在控制面内存里，补播从 persist 读并折叠 `message.delta`。
- 对话页 React 包在 `packages/web`；control-plane 托管 `dist/`。工具卡和模型文字按时间拆行，见 §9.3。
