# 云端 Agent Loop 技术方案（对标 Cursor 三态）

实现基线：`main`（2026-09-09，默认 `AGENT_KERNEL=pi`）。选型理由仍看 [agentscope-java-loop-plan.md](./agentscope-java-loop-plan.md)。`neo-loop` 进程、Turn 接口、tools 帧以 [agentscope-java-loop-design.md](./agentscope-java-loop-design.md) 为准。Desk 权限与爆炸半径以 [desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md) 为准。

本文是**从今天代码出发的落地规格**：已经做成了什么、还缺什么、Desk Remote 必须先补哪条通道、未决问题怎么锁。按本文开实现 PR，不要再写第三份「要不要做」的调研。

---

## 0. 一句话

> 学 Cursor，学的是「loop / 机器 / 对话」三态拆开，以及桌面端三种模式。不是把 Agent 嵌进 `control-plane`，也不是让笔记本装 JRE。

产品目标：

| 模式 | loop | 工具 | 推理 | 本仓库目标 |
| --- | --- | --- | --- | --- |
| Web / CLI / 手机 / Desk · Cloud | 云端 `neo-loop` | 云端槽 / 容器 | Gateway | **A。** 第 1–2 期骨架已在；第 3 期把会话从槽上解绑 |
| Desk · This Computer | 本机 pi | 本机盘 | Gateway | **B。** 已落地，**永久保留** |
| Desk · Remote Control | 云端 `neo-loop` | 本机盘（RPC） | Gateway | **C。** 合约已允许，通道和权限未做 |

Cursor 桌面端**不是**一律云端 loop，本仓库也不要做成一律云端 loop：

| Desk 下拉 | loop | 工具 | 本仓库 |
| --- | --- | --- | --- |
| This Computer | **本机**（桌面进程 / pi） | 本机盘 | 已落地，禁止改成 `neo-loop` |
| Cloud | 服务器 | 云端槽 | `kernel=agentscope` 时 `neo-loop`；默认 pi 仍同址 |
| Remote Control | 服务器 | 本机盘 | `{loop:cloud, tools:desk, remoteControl}` + `kernel=agentscope` |

Web / CLI / 手机 / Desk · Cloud / Desk · Remote 只打 `/v1` + SSE，那些客户端不跑 loop。This Computer 例外：人坐在这台电脑前面，loop 就在这台电脑上。推理一律走 Gateway。

---

## 1. 「loop 在服务器」有三层，不要混

| 层 | 含义 | 本仓库 | 还要不要做 |
| --- | --- | --- | --- |
| 产品 | 浏览器 / 手机发任务，本机不跑 Agent | Web / CLI / Mobile / IM **已经是** | 不用为这个再引入 Java |
| 一期架构 | loop 和工具同址，都在隔离单元 | 现网默认 `kernel=pi`：槽里的 `createAgentSession` | 现网 4C/4G 两槽靠这个活着，**不要拆掉** |
| Cursor 现行 | loop 在可恢复工作流，工具在机器上 | `kernel=agentscope` 骨架已在；会话仍是文件、Desk Remote 未通 | **本文要做的** |

Cursor 桌面端**不是**一律云端 loop：

- This Computer：loop 在桌面进程，推理在云。官方：*"Local describes where the agent loop and filesystem access run, not where the model runs."*
- Cloud：loop 在 Temporal，工具在托管 VM。官方：*"Because the agent loop lives in Temporal rather than on the VM itself, we can manage pod lifecycles independently."*
- Remote / Self-Hosted：loop + 推理 + planning 在 Cursor 云，你的 worker 只做文件和终端。机器**出向**拨长连接。*"Cursor never connects into your network."*

本仓库 Desk 一期抄的是出向 inbox + 严格匹配，**loop 仍在 Desk**。这和 Cursor Remote 不是同一个东西。

---

## 2. 锁死的原则

1. **控制面不跑 loop，loop 不碰磁盘，Gateway 不执行工具。** 禁止把 `HarnessAgent` 嵌进 `packages/control-plane`，禁止 JVM 打进 worker 镜像，禁止在 loop 宿主机上 `LocalFilesystemSpec` / `sh -c`。
2. **事件只由 loop 盖章。** 执行器可以推 `exec.stdout` 碎片，最终 `RunEvent` + `workerSeq` 由 `neo-loop` 写 `POST /internal/runs/:id/events`。Desk 不得直接推工具事件。
3. **一个用户回合 = 一条短工作流。** 不要一条 Run 一个永远活着的 Temporal workflow。
4. **对外 `/v1` 零变化。** 客户端用 `kernel` / `target` 选路径，不感知 `turnId`（诊断接口以后再加）。
5. **This Computer 继续本机 pi。** 不要为了统一强迫笔记本装 JRE。
6. **`:8082` 永不进 Caddy / 防火墙。** Desk 过网必须走控制面反代，见 §6。
7. **现网默认保持 `AGENT_KERNEL=pi`。** 金丝雀用 `CreateRunRequest.kernel: "agentscope"`。4C/4G 加内存之前不要切默认。
8. **绝对路径不上云。** 工具 RPC 用 `runId` + `deskWorkspaceId` 寻址，路径解析留 Desk。

新原则（取代「loop 必须在 VM 里」）：

> 推理在 Gateway。Loop 在 `neo-loop`。工具在执行面。三者不要住在同一个进程里。

---

## 3. 今天代码已经落到哪

对照 [agentscope-java-loop-design.md](./agentscope-java-loop-design.md) 第 1–2 期，**不要从零再写一遍 neo-loop。**

### 3.1 已落地（可当依赖）

| 能力 | 落点 |
| --- | --- |
| `Run.kernel` / `AGENT_KERNEL` / `WORKER_ROLE` | `packages/contracts/src/kernel.ts` |
| `assertExecutionTarget`：`agentscope` 允许 `{loop:cloud, tools:desk}`；禁止 desk loop + cloud tools | `packages/contracts/src/run.ts` |
| tools 帧 v1（hello / exec / fs.* / abort / ping） | `packages/contracts/src/tools-channel.ts` |
| 执行器 + 路径逃逸 + 流式 stdout | `packages/worker/src/tools-server.ts`、`path-guard.ts` |
| tools 出向 WS | `packages/worker/src/tools-ws.ts` → `ws://<NEO_LOOP_URL>/internal/tools/{runId}` |
| `WORKER_ROLE=tools` 不打开 pi，inbox 只收 `shutdown` / `abort` | `packages/worker/src/index.ts` |
| Java `neo-loop`：`LocalTurnEngine`、Harness / `LOOP_ENGINE=react` 回退、tools hub、文件 session / step log | `services/neo-loop` |
| `dispatchTurn` / `signalTurn` / `turn-complete` / `turn-heartbeat` | `packages/control-plane/src/loop/client.ts`、`orchestrator.ts`、`api/server.ts` |
| agentscope 不把 prompt 塞 pi inbox，worker ready / Desk `claim` 后 `startPendingLoopTurn` | `pendingLoopStarts` |
| Desk assignment 已带 `kernel` / `neoLoopUrl` / `neoLoopToken`；`kernel=agentscope` 时 fork `WORKER_ROLE=tools` | `packages/desk/app/host.ts` |
| 编排单测 + `packages/control-plane/src/e2e/agentscope-turn.test.ts` | 本地 mock 可 IDLE |

### 3.2 明确还没做（本文剩余工作）

| 缺口 | 为什么挡 Cursor 形态 |
| --- | --- |
| `AgentStateStore` 仍是 `.neo/runs/.loop/` 文件 | JVM 换机 / 卸槽后会话不在 Redis/MySQL，跟进会丢上下文 |
| 没有 `turn.rewind`，Gateway 没有 `X-Neo-Step-Id` 幂等缓存 | 推理闪断会把半截 delta 和重试叠在 transcript 上 |
| IDLE 卸槽与 loop session 未验收「同一 `sessionId` 恢复」 | 槽一卸，agentscope 路径和 pi 一样要靠工作区写回碰运气 |
| **Desk 拿到的 `neoLoopUrl` 是 `http://127.0.0.1:8082`** | 笔记本连的是自己，不是应用机。这是 Remote 的第一块挡路石 |
| 没有 `GET /v1/desks/:id/tools/:runId` WSS 反代 | `:8082` 不能暴露；现有 inbox SSE 单向、无 `callId`、不能流式 |
| Desk 侧还没有独立于「整份 worker」的长期执行器生命周期策略 | Remote 若仍 `WORKER_EXIT_AFTER_TURN=1`，每轮都要重拨 WS |
| 沙箱 / hooks 仍主要挂在 worker 进程；Remote 的鉴权仍是 run JWT + loop token | 泄漏 JWT ≈ 笔记本任意 `bash`。见 desk-phase2 §4.3 |
| 产品 UI 没有「云端大脑 + 本机手脚」模式 | 合约允许，composer 还没开门 |
| `isDeskTarget` 仍有编排残留 | 拆轴时最容易改错的 20 处语义点，部分已改 `isDeskToolsTarget`，handoff 等仍要逐个重判 |
| Temporal | 第 5 期可选。现网单机不要上 |

### 3.3 半成品陷阱

Desk 在 `kernel=agentscope` 且 `{loop:desk, tools:desk}` 时**已经**会起 `WORKER_ROLE=tools` 并连 `assignment.neoLoopUrl`。这只在「Desk 和 neo-loop 同机」（`pnpm dev:desk`）碰巧能通。把它当成 Remote 已做成，是错的：

- `loop: "desk"` 语义是「loop 在这台电脑」，和实际「loop 在 neo-loop」打架。
- 真 Remote 必须是 `{ loop:"cloud", tools:"desk", deskId, remoteControl:true }` + `kernel:"agentscope"`。
- 过网 URL 必须是控制面源，不是 `127.0.0.1:8082`。

---

## 4. 目标形态

### 4.1 进程（现网应用机）

```
客户端（Web / CLI / Desk / Mobile / IM）
        │  /v1 + SSE    Desk 另开 WSS /v1/desks/:id/tools/:runId
        ▼
Caddy :443                   不反代 :8082
        │
        ▼
control-plane :8080          编排、SCM、SSE、Desk 反代
        ├──────────────► llm-gateway :8081
        ├──────────────► neo-loop :8082（仅 127.0.0.1）
        └──────────────► Runtime
                              ├ cloud tools: neo-worker WORKER_ROLE=tools（槽 / 容器）
                              └ desk tools: 笔记本上的 ToolsServer（经 Caddy 反代）
```

| 进程 | 语言 | 绑定 | 信任级 |
| --- | --- | --- | --- |
| `control-plane` | TS | `:8080` | 高：账号、SCM、状态机、Desk 反代 |
| `llm-gateway` | TS | `:8081` | 高：唯一持钥 |
| `admin-api` | TS | `:8090` | 高：后管 |
| `neo-loop` | Java 21 | `127.0.0.1:8082` | 高：能看消息和 tool schema，不能看盘、不能看 Provider Key |
| `neo-worker` | TS | 无入站 | 低：按 Run 隔离 |

### 4.2 三种 ExecutionTarget

```
{ loop:"cloud", tools:"cloud" }                         // A. 云端 Run
{ loop:"desk",  tools:"desk", deskId }                  // B. This Computer（pi）
{ loop:"cloud", tools:"desk", deskId, remoteControl }   // C. Remote（agentscope only）
```

禁止：`{ loop:"desk", tools:"cloud" }`。`kernel=pi` 继续 `assertColocatedTarget`。

### 4.3 一次云端 agentscope 回合（已实现，作为不变式）

```
POST /v1/runs { kernel:"agentscope" }
  → provision 槽，WORKER_ROLE=tools
  → worker 出向连 ws://127.0.0.1:8082/internal/tools/{runId}
  → claim / attach 后 dispatchTurn
  → neo-loop Infer → Gateway；Tool → tools WS
  → 只 loop 写 RunEvent
  → turn-complete → IDLE
```

同机 Unix / loopback WS，RTT 可忽略。第 3 期要保证：**卸槽只丢机器，不丢 `sessionId=runId` 的 loop 会话。**

### 4.4 一次 Desk Remote 回合（要新做）

```
Web/手机/另一台 Desk
  POST /v1/runs {
    kernel: "agentscope",
    target: { loop:"cloud", tools:"desk", deskId, remoteControl:true }
  }
  → 不 provision 云槽
  → inbox SSE 推 assignment（不含 neoLoopUrl=127.0.0.1，不含绝对路径）
  → 目标 Desk 起 ToolsServer（可复用 packages/worker 的 tools 角色）
  → Desk 出向:
       wss://neorun.cloud/v1/desks/{deskId}/tools/{runId}
       Authorization: Bearer <desk token>
       X-Neo-Run-Jwt: <run JWT>          // 只证明「这条 Run」，不能单独过闸
  → Caddy → control-plane 验 desk token + 该 Run 属于该 desk + lease
  → 反代到 ws://127.0.0.1:8082/internal/tools/{runId}?token=<NEO_LOOP_TOKEN>
  → claim 后 dispatchTurn
  → 之后与云端 agentscope 同一套 Turn / 事件 / 跟进
```

控制面**不**把 tools payload 读进 orchestrator 业务线程。反代是字节管道 + 鉴权。

---

## 5. 三份状态分别存哪

| 状态 | 存哪 | 谁写 | IDLE 卸槽 / Desk 掉线 |
| --- | --- | --- | --- |
| Run 元数据 | 控制面 MySQL / `.control` | 控制面 | 保留 |
| 跟进队列 | `followUps` + Redis | 控制面 | 保留 |
| Transcript | `RunEvent`（Redis 热，MySQL / 对象存储冷） | **loop** | 保留 |
| Loop session（messages / plan / compaction） | 第 3 期：`loop:session:{runId}` Redis 热、`loop_sessions` MySQL 冷 | loop | **不丢** |
| 机器工作区 | 槽盘 / `RUNS_DIR/<runId>` 或 Desk 授权根 | tools worker | 云端可写回再卸；Desk 盘一直在 |
| Provider Key | Gateway | 人 / New API | 与 Run 无关 |
| run JWT | 控制面签发 | 控制面 | 短寿命，重启轮换 |
| desk token | 控制面签发，只在 Desk | 控制面 | 掉线作废 inbox，token 仍可重拨 |

现网 loop 仍写 `.neo/runs/.loop/`。第 3 期迁 Redis/MySQL 时 key 前缀 `loop:`，不要和 `runs/<id>/events` 抢。

`snapshotSpec` 继续 `NoopSnapshotSpec`。整盘生命周期归 `Runtime` + [workspace-persistence.md](./workspace-persistence.md)，不要 AgentScope 每 turn 打 workspace tar。

---

## 6. Desk Remote 的第一块挡路石：WSS 反代

### 6.1 为什么现有通道全不够

| 通道 | 形态 | 为什么不能当工具 RPC |
| --- | --- | --- |
| `GET /v1/desks/:id/inbox` | CP→Desk 单向 SSE，`assignment` / `cancel` / `ping` | 无 `callId`、无反向流、无 bash 增量 |
| worker inbox 400ms 轮询 | 半双工 HTTP | 一回合 50 次工具 = 20s 空等 |
| `NEO_LOOP_URL=http://127.0.0.1:8082` | 应用机 loopback | 笔记本连自己；Caddy 又不能放行 `:8082` |
| Desk 本机 IPC | `desk:term-data` | 实现执行器的素材，不是过网协议 |

Cursor 用 HTTP/2 双向流。本仓库现网是单机 + Caddy，**第一期用 WebSocket**，与已落地的 tools 帧兼容。企业代理再评估 HTTP/1.1 回退，不要第 4 期第一天就上 gRPC。

### 6.2 新路由（控制面）

```
GET /v1/desks/:deskId/tools/:runId
Upgrade: websocket
Authorization: Bearer <desk token>
```

握手校验（**全部**通过才 `upgrade`）：

1. desk token → 该 `deskId`，且 `online`（正握着 inbox）。
2. `run.executionTarget.tools === "desk"` 且 `deskId` 匹配。
3. `run.kernel === "agentscope"` 且 `run.executionTarget.loop === "cloud"`。
4. 该 desk 已 `claim` 这条 Run，或 handshake 与 `claim` 允许同请求完成（推荐：先 `claim` 再拨 WSS，避免无主连接）。
5. 可选 `X-Neo-Run-Jwt` 必须是**这条** Run 的 JWT；缺了或错了直接 401。run JWT **单独**不够。
6. 连接带上 `leaseId`（claim 返回）。loop 侧 `ToolsHub.attach` 已按 `runId` 登记；反代层再记 `deskId+runId+leaseId`，对不上就断。

升级后：控制面把帧原样转到 `neo-loop`。控制面可以数帧做限流（每 Run 同时在途 `callId` ≤ 8，单帧 ≤ 256KiB），**不解析 command 文本做业务**。

### 6.3 Caddy

只加这一条 WebSocket，**不要** `reverse_proxy :8082`：

```
handle /v1/desks/*/tools/* {
    reverse_proxy 127.0.0.1:8080
}
```

与现有 SSE 一样需要立刻 flush。测：国内笔记本 → `wss://neorun.cloud` → 北京应用机，bash 50ms / 4KiB 刷帧是否仍像本机 `tool.update`。

### 6.4 assignment 字段改动

`DeskAssignment` **删除**对笔记本有害的 `neoLoopUrl` / `neoLoopToken`（或仅当 `controlPlaneUrl` 是 loopback 时保留，方便 `pnpm dev:desk`）。

Desk 连工具通道的规则：

```
if (kernel === "agentscope" && target.loop === "cloud") {
  toolsUrl = `${controlPlaneUrl}/v1/desks/${deskId}/tools/${runId}`
  auth = deskToken
} else if (kernel === "agentscope" && isLoopback(controlPlaneUrl)) {
  toolsUrl = assignment.neoLoopUrl   // 仅本机开发
}
```

绝对路径继续不上报。`workspaceDir` 只出现在 `claim` 体，进 `deskWorkspaces` 内存，不进 MySQL 的 desk 清单。

---

## 7. 工具通道（已有帧，Remote 原样复用）

帧权威：`packages/contracts/src/tools-channel.ts`。第 4 期**不**新造第二套信封。缺的是传输和鉴权，不是 type。

约束（执行器强制，loop 的 PermissionEngine 不是安全边界）：

- 路径必须落在 Desk 授权根 / 槽 `sandboxRoot` 内（现有 `path-guard.ts`）。
- `exec.command` 是 `bash -lc`。AgentScope 的 `edit_file` / `grep_files` 都走这条，Java 不实现第二套文件系统。
- 同 Run 允许多个在途 `callId`（pi 默认并行）。协议已支持；反代不得串行化成一条 FIFO。
- stdout ≥50ms 或 ≥4KiB 一帧。
- 单帧文本 256KiB；更大走 `fs.upload` / `fs.download`。
- `abort` 杀一个；`abort_all` 杀全部。用户 `POST /v1/runs/:id/abort` 必须 **signal loop + abort_all 执行器**。

第 4 期若要二进制大文件，再加 binary 帧；先用 b64。

### 7.1 云工具仍不进 bash

| 工具 | 跑哪 | 原因 |
| --- | --- | --- |
| `read` / `edit` / `bash` / `grep` / `find` / `ls` | 执行器 | 必须碰盘 |
| stdio MCP | 执行器 | 进程和 cwd 在机器上 |
| HTTP MCP | 控制面 `/internal/runs/:id/mcp` | 密钥不进 Desk，也不进 loop |
| `neo_git_commit` / `neo_pr_open` | loop → 控制面 | 签名和 push 从不进 bash |
| `neo_memory_*` / `neo_subscribe` | loop → 控制面 | 旁路 |
| `neo_artifact_upload` | 执行器读文件 + 控制面收 | 签名 URL |
| `neo_browse` | loop / 控制面 | 不碰用户盘；仍受 egress |
| 子代理 | 同一 `NeoSandbox` / 同一条 WS | 不占第二槽；`callId` 带 `subagentId` 前缀 |

Desk 上的 `bash curl` **绕过**云端 egress。第 4 期在 Desk `ToolsServer` 重述一份 allowlist（至少拦任意出网或跟环境 `egress` 走）。不要假装云端策略罩得住笔记本。

---

## 8. 锁定 desk-phase2 未决问题

[desk-phase2-tool-rpc.md §6](./desk-phase2-tool-rpc.md) 留下的问题，本文拍板。要改先改本文。

| # | 问题 | 决定 |
| --- | --- | --- |
| 1 | 第 4 期到底买什么 | **三件事：** loop 升级不重打 Desk 安装包；会话 / compaction 在云端；和 Cursor Remote 形态对齐。**不**再买「网页能派活」——一期 dispatch 已经有了 |
| 2 | 执行器跨回合活着吗 | **Remote：活着。** 云 loop 按 turn 退，Desk `ToolsServer` 跟 desk inbox 同寿（Desk 在线且该 Run 未归档）。This Computer（pi）继续 `WORKER_EXIT_AFTER_TURN=1` |
| 3 | 子代理工具跑哪 | **全部同一条 Desk WS。** 禁止一条 Run 里两种工具位置。流量放大用「子代理默认只读工具 + 并发上限 4」收，不为子代理再 provision |
| 4 | 一台机器几条云 loop | **同一 `deskWorkspaceId` 同时只一条 RUNNING Remote。** 第二条 fail closed，文案「这台电脑正在改这个仓库」。不同仓库可以并行，上限 2（设置可调）。不抄 Cursor 未修好的「整机一把锁」 |
| 5 | 要不要逐条审批 | **保留已有「每次确认」，默认关。** Remote 无人值守：读类工具默认 allow，`write` / `edit` / `execute` 走 Desk 侧 allowlist（可预填常见命令）。不做 Cursor 那种未文档化的空白。Web 发起的 Remote **不**回落「等人点允许」，否则手机跟进会卡死；敏感命令用 allowlist，没有条目就拒 |
| 6 | 绝对路径 | **继续不上云。** 寻址 `deskId` + `deskWorkspaceId` + 相对路径 |

This Computer 与 Remote 的安全模型保持分离：人在机器前面点 This Computer ≠ 绑定即授权被网页派活。Remote 开关继续默认关。

---

## 9. 控制面状态机（几乎不动）

```
NOT_YET_STARTED → PROVISIONING → INSTALLING → RUNNING ⇄ IDLE
```

谁在 RUNNING：`neo-loop` 有一条未 `turn-complete` 的 turn。不是「worker 进程还活着」。

| 用户动作 | `kernel=pi` | `kernel=agentscope` |
| --- | --- | --- |
| IDLE 发消息 | inbox `prompt` | `dispatchTurn`（必要时先 provision / 等 Desk claim） |
| RUNNING 改方向 | `session.steer` | `signalTurn({type:"steer"})`；无 AgentScope 原语，用「abort 在途 tool + Hint」近似 |
| RUNNING 做完再做 | `session.followUp` | `queueLoopFollowUp`，`turn-complete` 后再 `dispatchTurn` |
| 取消 | `session.abort` | `signalTurn(abort)` + 执行器 `abort_all`；Run 回 IDLE + `cancelled`，不标 ERROR |

心跳拆两轴（第 3 期做完，第 4 期 Desk 复用）：

| 轴 | 信号 | 掉了怎么办 |
| --- | --- | --- |
| loop | `POST /internal/runs/:id/turn-heartbeat`（已有 `noteLoopHeartbeat`） | RUNNING 超过超时：重入当前 turn 或标可恢复错误，**不要**立刻当用户取消 |
| tools | tools WS `ping/pong` + worker / Desk claim 心跳 | 只丢工具通道：`detachOrQueue`，不标 ERROR。Desk 重拨 WSS 后 loop 从 `EnsureMachine` 再等 ready |

`WAITING_FOR_BACKGROUND_WORK` 留给共享同一沙箱的后台子代理。第 3 期以前可以不实现。

---

## 10. Durable Turn 与 rewind（第 3 期）

`TurnWorkflowEngine` 接口已在。`LocalTurnEngine` 已按步写 `FileStepLog`，但：

- 重试不会发 `turn.rewind`。
- Gateway 不认 `X-Neo-Step-Id`。
- session 不在 Redis/MySQL。
- JVM 被杀后扫描 `RUNNING` step 重入**未验收**。

第 3 期补齐，仍不上 Temporal：

1. `loop_sessions` / `loop_turn_steps` 进控制面同一 `DATABASE_URL`，前缀 `loop_`。没库则继续文件。
2. Redis：`loop:session:{runId}`、`loop:tools:{runId}`、`loop:turn:{turnId}` 短锁。
3. Infer 失败且已经推过 `message.delta`：先发

```json
{ "kind": "turn.rewind", "data": { "replyId": "…", "fromSeq": 120 } }
```

   `foldRewoundEvents` 已有语义（overview §5）。第 3 期保证 **transcript snapshot** 正确；直播页覆盖可以第 3 期后半。
4. Gateway：同一 `X-Neo-Step-Id` 成功响应回放，避免二次扣费。没有缓存时：**只在失败后重试，成功不重放**。
5. IDLE + `WORKER_IDLE_RELEASE_MS`：卸槽 → 跟进 → 重新 provision → **同一 `sessionId=runId`** → 新 worker 再拨 tools WS。e2e 必须覆盖。

第 5 期再加 `TemporalTurnEngine`，workflow/activity 与现在 1:1。Temporal Server 另机，不进 4C/4G。

---

## 11. 安全

| 威胁 | 对策 |
| --- | --- |
| 偷 Provider Key | loop / Desk / worker 只有 run JWT |
| prompt injection 让 loop 乱 exec | 伤害面是「对已租约机器发 exec」。执行器沙箱 + allowlist 是边界，不是 loop 的 PermissionEngine |
| 伪造 turn | `NEO_LOOP_TOKEN` 仅内网；loop 调 `/internal` 必须带该 Run JWT |
| 横向 Run | tools WS 绑 `runId`+lease；帧里 path/runId 对不上就断 |
| 笔记本任意命令 | Desk token **和** run JWT **和** claim lease；缺一不可。控制面反代层强制 |
| 把 `:8082` 暴露到公网 | Caddy / 防火墙禁止。现网 `deploy.sh` 已不 enable loop，保持 |
| rewind 泄露半截秘密 | 控制面 `redactRunEvent`；loop 推事件前用同一份 redact 列表 |
| Desk `bash curl` 外带源码 | Desk 侧重述 egress；云端 allowlist 罩不住 |

爆炸半径（写进实现 PR 描述，避免产品当功能卖）：

> 任何能创建 `{ loop:"cloud", tools:"desk" }` 的客户端，都获得了在那台笔记本上执行命令的能力，而且不需要人坐在前面。

所以：Remote 开关默认关、匹配 fail closed、不回落云端盘、同一工作区一条 RUNNING、敏感命令 allowlist。

---

## 12. 现网与本地

```
AGENT_KERNEL=pi|agentscope
NEO_LOOP_URL=http://127.0.0.1:8082
NEO_LOOP_TOKEN=…
NEO_LOOP_JAVA_XMX=512m
WORKER_ROLE=all|tools
```

4C/4G 账：2×512MiB worker + 512MiB loop + control-plane + gateway。答不上「两槽满载 + loop JVM + 一次 Pro 推理会不会 OOM」就不要 Enable `neo-loop.service`。

本地：

```
export PATH="$HOME/.nvm/versions/node/v$(cat .nvmrc)/bin:$PATH"
pnpm dev                 # :8080 + :8081
pnpm dev:loop            # :8082
# 云端闭环
curl -s -X POST localhost:8080/v1/runs \
  -H 'content-type: application/json' \
  -d '{"prompt":"…","repoUrls":["fixtures/toy-repo"],"kernel":"agentscope"}'
```

Desk Remote 本地：`pnpm dev:desk` + 第二条控制面 URL 指 `127.0.0.1:8080`，WSS 走 `/v1/desks/.../tools/...`，即使同机也不让 Desk 直连 `:8082`（开发可留 loopback 快路径，单测必须覆盖反代路径）。

---

## 13. 分期（从今天往后排，不重做第 1–2 期）

第 0–2 期（协议、`neo-loop` 最小闭环、`WORKER_ROLE=tools`）**已经在 main**。下面只排剩余。

### 第 3 期 — 云端 loop 可恢复（先做，Desk 才能共用）

目标：`{loop:cloud, tools:cloud}` 卸槽、重启、闪断之后对话还在。

| 文件 | 做什么 |
| --- | --- |
| `services/neo-loop/.../store/` | Redis + MySQL 实现；文件回退保留 |
| `services/neo-loop/.../LocalTurnEngine.java` | 失败发 `turn.rewind`；扫描未完成 step 重入 |
| `packages/contracts` | `RunEventKind` 增加 / 对齐 `turn.rewind` |
| `packages/control-plane` 事件折叠 | snapshot 丢掉 `replyId` + `fromSeq` 之后的 delta |
| `packages/llm-gateway` | 可选 `X-Neo-Step-Id` 成功回放 |
| e2e | 卸槽后再 follow-up；杀 JVM 再 dispatch 同一 `sessionId` |

验收：

- toy-repo agentscope → IDLE → 卸槽 → 跟进，上下文还在，工作区从写回盘恢复。
- 控制面重启不丢 IDLE agentscope Run。
- `AGENT_KERNEL=pi` 的 `pnpm test` 全绿。
- 现网默认仍是 pi。

### 第 4a 期 — 沙箱先搬到可独立运行的模块

在 **还没开 Remote 产品入口** 时做。用现有 This Computer（pi，loop 仍本机）验证逃逸 / hooks。

| 文件 | 做什么 |
| --- | --- |
| `packages/worker/src/path-guard.ts` / `sandbox.ts` / `hooks.ts` | 抽成 Desk 和 tools worker 都能 import 的模块，不依赖 `createAgentSession` |
| `packages/desk` | This Computer 路径改走该模块（行为不变） |
| 单测 | `/etc/passwd`、写根外、protected 路径继续拒 |

验收：`pnpm test` + 本机 Desk 改文件仍锁在授权根。**不**解 `assertColocatedTarget`。

### 第 4b 期 — 控制面 WSS 反代

| 文件 | 做什么 |
| --- | --- |
| `packages/control-plane/src/api/desk-tools-proxy.ts`（新） | §6.2 握手 + 字节管道 + 限流 |
| `packages/control-plane/src/api/server.ts` | 挂路由 |
| `packages/contracts/src/desk.ts` | assignment **不再**向非 loopback Desk 发 `neoLoopUrl` |
| `packages/desk/app/host.ts` / `src/spawn.ts` | Remote 拨 `/v1/desks/:id/tools/:runId` |
| `packages/worker/src/tools-ws.ts` | 支持 desk token 头；URL 可指向控制面 |
| Caddy / `docs/production-domain.md` | 只加这一条 WS，不放行 `:8082` |
| 单测 | 无 desk token / 错 run / 未 claim → 拒绝；帧原样到达假 neo-loop |

验收：NAT 拓扑用「两个 loopback 端口模拟」（Desk 进程只知道 `:8080`，`:8082` 对它不可达）跑通 `exec` + 流式 stdout。

### 第 4c 期 — 解开产品入口

| 文件 | 做什么 |
| --- | --- |
| `packages/control-plane/src/orchestrator/orchestrator.ts` | 创建 `{loop:cloud, tools:desk}` 时 **不** provision 云槽；`claim` 后 `dispatchTurn`（claim 钩子已在） |
| 逐个 `isDeskTarget` 残留 | 问「这里要的是 loop 轴、tools 轴，还是 desk 生命周期」 |
| `packages/web` composer | Remote 目标选择；匹配失败四种文案，**不**回落云盘 |
| `packages/mobile` | 列表已有 Desk Remote；新开仍默认 cloud。跟进走同一 Run |
| Desk 执行器寿命 | Remote 不 `WORKER_EXIT_AFTER_TURN`；This Computer pi 不变 |
| 文档 | `architecture.md` §2 / §17.5、overview、`desk.md` 反转 |

验收：

- 网页开 Remote → 笔记本只出向 WSS → 改的是授权文件夹 → transcript 工具在答复上面。
- loop 升级（只发 `neo-loop` jar）不重打 `pnpm pack:desk`。
- 匹配失败 fail closed。
- 泄漏 run JWT、没有 desk token，执行器不跑命令。
- This Computer 回归：行为与现在一致。

### 第 5 期 — Temporal（可选）

`TemporalTurnEngine` 实现同一接口。另机部署。一个 turn 一个 workflow。现网轻量跳过。

---

## 14. 第 4 期文件级爆炸半径（实现时对照）

分级：S 小改 / M 实质 / N 新子系统。

| 包 | 级 | 要点 |
| --- | --- | --- |
| `packages/control-plane` | **N + M** | WSS 反代新文件；orchestrator 拆 provision；assignment 去掉公网 `neoLoopUrl` |
| `packages/desk` | **M** | 拨控制面 WSS；Remote 执行器寿命；egress 重述；不新增「整份第二 worker」 |
| `packages/worker` | **M** | tools-ws 多一种 URL/鉴权；沙箱模块可被 Desk 复用 |
| `packages/contracts` | **S–M** | assignment 字段；不必新造 tools 帧 |
| `packages/web` / `mobile` / `cli` | **S–M** | 目标选择与文案 |
| `packages/llm-gateway` | **S** | 仅第 3 期 step id |
| `packages/extensions` | **S–M** | git/artifact 本地读仍在执行器；browse 留云 |
| `services/neo-loop` | **S** | 不必为 Desk 改帧；ToolsHub 已按 runId |
| 文档 / Caddy | **M** | §2 原则反转；Caddy 不碰 `:8082` |

测试最小集：

- `contracts`：`assertExecutionTarget` 拆轴。
- orchestrator：agentscope + desk tools **不**占云槽；claim 后才 `dispatchTurn`。
- desk-tools-proxy：鉴权矩阵。
- tools-server：逃逸 / abort / 流式（已有，保持）。
- e2e：反代后的 toy-repo agentscope（可用内存执行器）。
- `AGENT_KERNEL=pi` 全绿。

---

## 15. 明确不做

1. 不在 `control-plane` 嵌 Harness / JNI。
2. 不把 JVM 打进 worker / Desk。
3. 不用 AgentRun / E2B / Daytona 换执行面。
4. 不接 AgentScope IM Channel（IM 仍走 `ingress/`）。
5. 不把 `pi-client` 远程会话整套搬进来——方向相反（那是搬会话，我们搬工具）。
6. 不抄 `workspaceRootPath` 上报。
7. 不为了 RPC 放弃 Desk 侧沙箱。
8. 不把 `:8082` 暴露到公网。
9. 不把 CLI / 手机改成本机 Agent。
10. 第 3 期以前不解产品上的 `loop !== tools`。
11. 不为 Java 另开 Git 仓库。
12. 不把「换了 AgentScope」写成产品卖点。用户看见的还是 Neo Run。
13. 不上 Nginx，不把 New API 提升成 Neo 进程。

---

## 16. 和已有文档的关系

| 文档 | 关系 |
| --- | --- |
| [architecture.md](./architecture.md) §2 / §17.5 | 一期锁。第 4c 落地时改写成本文 §2 那句 |
| [architecture-overview.md](./architecture-overview.md) | 现状地图。第 3 / 4 期落地后再改主路径时序 |
| [agentscope-java-loop-plan.md](./agentscope-java-loop-plan.md) | 为什么选路径 C。不重复 |
| [agentscope-java-loop-design.md](./agentscope-java-loop-design.md) | Turn / Java 包 / 内网接口的权威。本文不改那些名字 |
| [desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md) | 调研与爆炸半径。§6 未决由本文 §8 锁定；传输方案由本文 §6 定为「控制面 WSS 反代」 |
| [desk.md](./desk.md) | This Computer / 一期 Remote 行为。第 4c 后改「Remote 的 loop 在云端」 |
| [workspace-persistence.md](./workspace-persistence.md) | 机器生命周期仍归 Runtime |

接口名冲突时：先改 [agentscope-java-loop-design.md](./agentscope-java-loop-design.md) 和本文，再改代码。Desk 过网 URL 以本文 §6 为准（design 里「Desk 直连 neo-loop + `X-Neo-Desk-Token`」在现网不可行）。

---

## 17. 给决策用的验收清单

**第 3 期（云端可恢复）**

- [ ] agentscope + 卸槽 + 跟进：session 与 transcript 都在
- [ ] `turn.rewind` 后 snapshot 不出现叠字
- [ ] Gateway 无 Provider Key
- [ ] 现网默认 pi

**第 4 期（真 Remote）**

- [ ] Desk 在 NAT 后只出向 `wss://…/v1/desks/:id/tools/:runId`
- [ ] `:8082` 对 Desk 不可达仍能跑完一轮
- [ ] 无 desk token 或未 claim：零 exec
- [ ] 事件由 loop 盖章，`workerSeq` 不乱
- [ ] 匹配失败不回落云盘
- [ ] This Computer 无回归
- [ ] 升级 `neo-loop` 不重打 Desk 包

---

## 18. 建议的开工顺序（实现 PR）

1. 第 3 期 store + rewind + 卸槽 e2e（云端先稳，Remote 才能共用 session）。
2. 第 4a 沙箱模块（安全底座，产品入口仍关）。
3. 第 4b WSS 反代 + assignment 去掉公网 `127.0.0.1:8082`。
4. 第 4c 解开 `{loop:cloud, tools:desk}` 产品入口、UI、文档反转。
5. 现网 Enable `neo-loop` 只在加内存或减槽之后，且只金丝雀 `kernel=agentscope`。

选型「为什么不嵌控制面」仍看 [agentscope-java-loop-plan.md](./agentscope-java-loop-plan.md) §5 路径 B。
