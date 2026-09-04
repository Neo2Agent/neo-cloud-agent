# 把 Agent loop 搬到服务器：对照 Cursor，用 AgentScope Java 改造 Neo

调研 + 改造方案。2026-09-04。基线 `main` `0bd20a1`。

对照：[architecture.md](./architecture.md)（一期锁死的原则）、[architecture-overview.md](./architecture-overview.md)（现状）、[desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md)（云 loop + 本机工具，尚未做）。

Cursor 公开材料：[Cloud Agents](https://cursor.com/docs/cloud-agent)、[What we’ve learned building cloud agents](https://cursor.com/blog/cloud-agent-lessons)、[Self-Hosted Machines](https://cursor.com/blog/self-hosted-machines)。

AgentScope Java 公开材料：[2.0 总览](https://java.agentscope.io/v2/en/docs/index.html)、[Filesystem](https://java.agentscope.io/v2/en/docs/harness/filesystem.html)、[Sandbox](https://java.agentscope.io/v2/en/docs/harness/sandbox.html)、[Going to Production](https://java.agentscope.io/v2/en/docs/others/going-to-production.html)。

---

## 0. 结论先行

1. **Neo 已经把「用户侧不跑 Agent」做成了。** Web / CLI / 手机 / IM 只打 `/v1`，pi 在 worker 里，推理走 Gateway。这不是缺口，不要为了「像 Cursor」再把 loop 塞进控制面进程。
2. **Cursor 现在的云端 Agent 和 Neo 一期抄的不是同一个东西。** Neo 抄的是 Cursor 早期 Cloud Agent：loop 和工具都在隔离机里。Cursor 后来把 **agent loop、机器状态、对话状态** 拆开，loop 迁到 Temporal，工具留在 VM / 自建机器。官方原话：*"Because the agent loop lives in Temporal rather than on the VM itself, we can manage pod lifecycles independently."*
3. **AgentScope Java 2.0 对得上的是 Cursor 现在这套，不是「把 pi 换成 Java 再塞进现有槽」。** `ReActAgent` 无状态、按 `(userId, sessionId)` 恢复；`HarnessAgent` 自带 workspace / skills / compaction / HITL / `streamEvents()`；文件和 shell 走 `SandboxFilesystemSpec`，后端可以是 Docker / K8s / 自建远程执行器。
4. **推荐路径：控制面和 Gateway 不动；新增一个 Java loop 进程；现有 `neo-worker` 退化成工具执行器；用自定义 `SandboxFilesystemSpec` 对接现有槽和 Desk。** pi 先双核并存，用 `AGENT_KERNEL=pi|agentscope` 切。不要一把撕掉。
5. **明确不要做的四件事：** 用 AgentScope 替换整个 `control-plane`；把 `HarnessAgent` 跑在控制面进程里用 `LocalFilesystemSpec`；把 JVM 打进每个 VM 槽替换 pi；把执行面交给阿里云 AgentRun。

若采纳本方案，[architecture.md §2](./architecture.md) 和 §17.5（「不要为了推理在云端把 Agent 放控制面」）要改写成：

> **推理在 Gateway。Loop 在独立的 loop 进程（可恢复）。工具在执行面。三者不要住在同一个进程里。**

一期那条锁是对的——当时怕的是「每个 `read` / `bash` 做成跨网络 RPC 还丢掉 pi」。Cursor 自己后来证明：**loop 和工具拆开值得做，但前提是有双向流协议、沙箱跟着工具走、事件仍由 loop 盖章。** 本仓库 [desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md) 已经把这条路摸过一遍。AgentScope 给的是现成的 loop + 沙箱抽象，不是借口跳过那份报告里的协议和权限工作。

---

## 1. 先对齐三句话，避免改错层

「把 agent 循环放在服务器上」在本仓库里至少有三种意思。混在一起会同时改控制面、worker 和客户端。

| 含义 | Cursor | Neo 现状 | 还要不要做 |
| --- | --- | --- | --- |
| **产品**：人在浏览器 / 手机发任务，本机不跑 loop | Cloud Agents、CLI `-p`、手机跟进 | **已经是。** 客户端都是 `/v1` 宿主 | 不用为这个引入 Java |
| **一期架构**：loop 和工具同址，都在隔离单元 | Cursor **早期** Cloud Agent（work-stealing，worker 把 loop 跑完） | **已经是。** `WORKER_RUNTIME=local/vm/docker/desk` + 嵌入 `createAgentSession` | 这是现在的锁。现网 4C/4G 两槽能跑，就是靠这个 |
| **现在的 Cursor**：loop 在可恢复工作流，工具在机器上 | Temporal workflow + VM / `agent worker` | **没有。** `assertColocatedTarget` 禁止 `loop !== tools` | 这才是 AgentScope 该接的缝 |

一句话：

> Neo 要学的不是「把 loop 搬进 `packages/control-plane`」，而是「loop 不再绑死在某台槽 / 某个 Desk 进程上，机器可以休眠、只读、预热、换一种 pod，对话还能续」。

---

## 2. Cursor 云端 Agent 实际怎么做

公开材料能钉死的，按层摊开。不要用「云端」两个字糊过去。

### 2.1 用户看见的产品

- 从 Web / IDE / CLI / 手机 / Slack / GitHub 发起一条 Cloud Agent。
- 每条会话有隔离 Linux 环境：自己的依赖、自己的网络策略、自己的工作区。
- 本轮结束可以挂起；再发跟进就醒。可以并行很多条。
- 交付物是分支 + PR + artifacts，不是聊天记录本身。

这些 Neo 已经对上，见 [architecture-overview.md §5–§13](./architecture-overview.md)。

### 2.2 控制面 vs 执行面 vs 推理

| 层 | Cursor | Neo 对位 |
| --- | --- | --- |
| 账号、Run、环境、Build、SCM、事件扇出 | Cursor 后端 | `packages/control-plane` |
| 模型调用 | 永远在 Cursor 云。本地只表示文件和 shell 在哪 | `packages/llm-gateway` + run JWT |
| 文件 / 终端 / computer-use | 隔离 VM，或 Self-Hosted Machine 上的 worker | `packages/worker` + 槽 / Desk |
| Agent loop（想下一步、拼上下文、发 tool call） | **现在在 Temporal，不在 VM 里** | **现在在 worker 进程里的 pi** |

「推理在云端」和「loop 在云端」是两件事。Neo 已经做了前者。Cursor 后来又做了后者。

### 2.3 Cursor 自己写过的三次架构转折

来自 [cloud-agent-lessons](https://cursor.com/blog/cloud-agent-lessons)：

1. **早期：把本机 Agent 搬到服务器。** work-stealing，worker 捡起一条 Agent 把 loop 跑完。和现在的 Neo `local` / `vm` worker 是同一形态。他们说早期 beta 大约一个 9。
2. **loop 迁到 Temporal。** 推理闪断、pod 休眠/恢复、跨天任务都能续。官方数字：每天 5000 万+ activity、700 万+ workflow；内部 40%+ PR 来自 cloud agents。工作流从「一条永远活着」改成「一个任务一条短工作流」，方便升级。
3. **三态解耦。** agent loop、machine state、conversation state 分开。一个 Agent 可以在一台机器上跑、异步在几台机器上生子代理、从本机委托到云；子代理可以活过父会话。对话层是 append-only 存储 + 可 rewind 的流：某步失败重试时，客户端丢掉半截输出，播新的。

### 2.4 三种运行时，loop 不在同一边

| 模式 | loop | 工具 | 推理 | Neo 对位 |
| --- | --- | --- | --- | --- |
| This Computer | 桌面进程内 | 本机磁盘 | 云 | Desk `loop=desk, tools=desk`。**一期做对了** |
| Cloud Agent（Cursor 托管 VM） | **Temporal** | Cursor 云 VM | 云 | Neo 云端 Run。**loop 还在槽里，这是差距** |
| Remote Control / My Machines | **Cursor 云** | 你的机器。文件、终端、computer-use、stdio MCP | 云 | Desk Remote。**一期只抄了出向 inbox + 严格匹配，loop 仍在 Desk** |

Self-Hosted Machines 官方原话：*"Cursor runs the agent loop, inference, and planning. Your worker performs file edits and terminal commands."* 机器出向拨长连接，Cursor 永不打进客户网络。MCP 拆分最能反证 loop 在云：stdio 在你机器，HTTP/SSE 在 Cursor 后端。

### 2.5 Cursor 认为质量不在 loop 框架，在环境

同一篇 lessons 把「开发环境就是产品」放在 durable execution 前面：

- 云端必须从零重建本机开发者环境。没建好时往往不报错，只是输出变差。
- 需要：环境构建工具、VM 休眠/恢复、checkpoint / restore / fork、harness 和客户端对同一份环境的共同理解。
- 网络、密钥打码、egress、凭证——「给 Agent 做企业 IT」。
- harness 越来越薄：少写死多仓/CI 逻辑，多给工具让模型自己决定。computer-use 仍是专职子代理。
- 云端 prompt 要比本机更敢自己往下做，因为卡住没人看。

对 Neo 的含义：**换 Java 框架不会自动变好。** 现网两槽、Build / warm pool、`install`/`start`/`terminals`、egress、受控 git，这些才是 Cursor 说的「operating layer」。AgentScope 只替换「想下一步」那一层。

---

## 3. Neo 现在卡在哪

```
客户端 ──/v1──► control-plane ──provision──► Runtime（槽 / 容器 / Desk）
                                              │
                                              ▼
                                         neo-worker
                                              │ 同进程
                                              ▼
                                         pi-coding-agent
                                              │ run JWT
                                              ▼
                                         llm-gateway
```

锁死的句子在 [architecture.md §2](./architecture.md)：

> Agent loop 跑在 VM 里，不跑在控制面。

理由当时成立，现在要拆开看：

| 当时的论据 | 2026-09 还成不成立 |
| --- | --- |
| 每个 `read`/`bash` 走控制面 ↔ VM，延迟毁掉 coding agent | **仍成立。** 必须有并发双向流，不能拿现在的 400ms inbox 轮询顶 |
| 丢掉 cwd / 进程组 / tmux / pi | **半成立。** 工具仍必须在仓库旁边；loop 不必 |
| 等于丢掉 pi、自研远程执行器 | **对 pi 0.84.x 已不成立**（[desk-phase2-tool-rpc.md §3](./desk-phase2-tool-rpc.md)）。对 AgentScope 更不成立：沙箱 SPI 就是远程执行器 |
| 推理在云端靠 Gateway，不必搬 loop | **产品上仍对。** 可靠性上，Cursor 已经用 Temporal 证明「搬 loop」另有收益 |

现状里和「可恢复 loop」直接冲突的点：

- `packages/contracts/src/run.ts` 的 `assertColocatedTarget`：P0–P2 禁止 `loop !== tools`。
- worker 是「唯一和控制系统说话的进程」，它既跑 loop 又跑工具。槽一卸，loop 也没了。
- 跟进语义绑死 pi：`deliveryForPi` → `session.prompt` / `steer` / `followUp`。
- 会话权威是 worker 上的 pi JSONL，控制面只备份。loop 若换进程，这份日志要换店。
- Desk Remote 的 inbox 只有 `assignment` / `cancel` / `ping`，扛不住工具 RPC。
- 现网 4C/4G、2×4GiB loop 槽、`WORKER_MEMORY_MIB=512`。再往槽里塞 JVM 不现实。

Neo 已经比 Cursor 早期多做的（不要拆掉）：Run 状态机、Gateway 持钥、Build / warm pool、空闲写回、受控 SCM、多端 SSE transcript、专家 / 技能物化、Desk 沙箱、`workerSeq` 保序。

---

## 4. AgentScope Java 对得上哪一层

AgentScope Java 2.0 不是「再写一个 pi」。它是 **生产级 ReAct + Harness**：loop 无状态可水平扩，工具默认不信任宿主机。

### 4.1 和 Neo / Cursor 的层对照

| 能力 | AgentScope | 应对到 Neo 的哪一层 | 备注 |
| --- | --- | --- | --- |
| `ReActAgent` | reason → tool → respond，实例无状态，状态走 Reactor Context | **新 loop 进程** | 一个 JVM 可服务很多 `(userId, sessionId)` |
| `HarnessAgent` | workspace、分层记忆、skills、plan mode、compaction、子代理 | 替换 `openPiSession()` 那一层 | 不要让它管账号 / 配额 / 开 PR |
| `streamEvents()` | 28 种类型事件，可中断 | 映射到现有 `RunEvent` | 见 §7 |
| HITL / PermissionEngine | allow / approve / deny | Desk「每次确认」、敏感 bash | 审批必须在**工具侧**也强制一遍 |
| `AgentStateStore` | 内存 / JSON / MySQL / Redis | 替代 pi JSONL 备份 | 现网已有 MySQL + Redis，直接复用 |
| Filesystem 三模式 | Local / Remote KV / Sandbox | **只用 Sandbox** | Local 等于在 loop 宿主机上 `sh -c`，现网等于在应用机裸跑 |
| Sandbox 后端 | Docker / K8s / Daytona / E2B / AgentRun / **自建** | **自建 `NeoSandboxFilesystemSpec`** | 对接现有 Runtime，不要换执行面 |
| 模型 | 多 Provider | 只打 `llm-gateway`，Bearer 仍是 run JWT | Provider Key 不准进 JVM |
| Channel（飞书 / 企微） | 可选 | **不要接** | Neo 已有 `ingress/`，再接一套会双入口 |

### 4.2 文件工具长得像 pi，实现却不同

Harness 暴露 `read_file` / `write_file` / `edit_file` / `grep_files` / `glob_files` / `list_files` / `execute`。表面像 pi 的 `read` / `write` / `edit` / `grep` / `find` / `ls` / `bash`。

实现差异必须写进方案，否则 coding 体感会掉一截：

| 项 | pi（现在） | AgentScope Harness |
| --- | --- | --- |
| 文件工具怎么落地 | 进程内 TypeScript，直接碰磁盘 | **在沙箱里跑 POSIX shell**（`sed` / `grep` / `stat -c` / `python3` 做 edit） |
| bash 流式 | `onUpdate` → `tool.update`，约 100ms | 要自己从 `Sandbox.exec` 接流；默认更像一次返回 |
| 镜像契约 | 槽里是 Node worker + 仓库工具链 | 还要 GNU `stat`、`python3`、`tar`、`base64`。Alpine / distroless 不行 |
| skills | 扫 `.neo/skills`、`.cursor/skills`、`.pi/skills` 等多目录 | 默认 `workspace/skills/` | 控制面物化路径要适配，或写 SkillBox 适配器 |
| 子代理 | `neo_subagent` 同槽嵌套 session | `agent_spawn` / `agent_send`，可后台 | 背景子代理不要占第二槽，除非显式申请 |
| steer / followUp | pi 一等公民 | **没有同名 API** | 见 §6.3，必须在 loop 进程自建 |

### 4.3 为什么选 Java 这条，而不是把 loop 继续留在 Node

可以继续用 pi 做云端 loop——[desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md) 就是这条。引入 AgentScope 的理由只有三条，对不上就不要换：

1. **无状态副本。** `ReActAgent` 按设计就能多副本抢同一个 `(userId, sessionId)`。pi session 绑在一个 Node 进程 + 一份 JSONL 上。
2. **沙箱 SPI。** 自定义 `SandboxFilesystemSpec` 是官方接缝，不必 fork。pi 也能远程工具，但要自己拼三层契约。
3. **团队栈。** 如果 loop / 权限 / HITL 打算用 Java 团队维护，换内核比在 pi 上堆 Java 扩展更干净。

对不上这三条，换内核是净成本：双语言仓库、事件映射、现网内存、coding 工具体感都要重新买一遍。

---

## 5. 三条改造路径

### 路径 A — 不推荐：槽内换皮

JVM 打进每张 worker 镜像，`createAgentSession` 换成 `HarnessAgent` + `LocalFilesystemSpec`。

- 现网两槽各加一个 JVM，和 `WORKER_MEMORY_MIB=512` 抢 4G。
- loop 仍绑在槽上。槽卸了 loop 也没了。Cursor 迁 Temporal 要的东西一个没有。
- 控制面、事件、跟进还是按 pi 假设写的，等于重写 worker 却买不到架构收益。

### 路径 B — 禁止：控制面进程内跑 Harness

`control-plane` 里嵌 Java（或另起一个「其实就是控制面」的服务），`LocalFilesystemSpec` 直接打应用机磁盘。

- 应用机变成所有租户的 bash 宿主机。
- Provider Key、SCM 私钥、用户工作区进同一个信任域。
- 违反 [architecture.md](./architecture.md) 红线 2、4，也违反「执行面低信任」。

`AgentRunFilesystemSpec`（阿里云 FC 沙箱）同样禁止当 Neo 执行面：槽、Build、egress、受控 git、Desk、空闲写回全部作废，密钥和网络策略落到另一套云上。

### 路径 C — 推荐：独立 loop 进程 + 现有执行面当沙箱

```
客户端 ──/v1──► control-plane（TypeScript，编排仍在这）
                    │  provision 槽 / Desk（只起工具执行器）
                    │  派 turn 给 loop
                    ▼
              neo-loop（Java，AgentScope HarnessAgent）
                    │  OpenAI-compatible + run JWT
                    ▼
              llm-gateway（不动）
                    │
              neo-loop ──工具 RPC──► neo-worker / Desk executor
                                        │
                                        ▼
                                   /workspace + bash + tmux
```

锁死的新原则：

1. **控制面仍然不跑 loop。** 它只做现在做的事：鉴权、状态机、环境、SCM、事件扇出。
2. **loop 是第四个控制面进程，不是第五个「什么都管」的单体。** 现网进程变成：`control-plane`、`llm-gateway`、`admin-api`、`neo-loop`。
3. **工具永远在执行面。** 云端槽、Firecracker、Desk 本机，都只是 `NeoSandbox` 的不同 `Sandbox` 实现。
4. **Gateway 仍是唯一持钥者。** AgentScope 的 Model 只认 `LLM_GATEWAY_URL` + run JWT。
5. **事件仍由 loop 盖章。** 执行器可以推 `tool.update` 碎片，但 `workerSeq` / 最终 `RunEvent` 顺序由 loop 写。沿用 [desk-phase2-tool-rpc.md §4.4](./desk-phase2-tool-rpc.md)。

`ExecutionTarget` 两轴本来就为这个留着（`packages/contracts/src/run.ts`）：

```
{ loop: "cloud", tools: "cloud" }   // 现在的云端 Run；loop 从槽里搬到 neo-loop
{ loop: "desk",  tools: "desk"  }   // This Computer，不动
{ loop: "cloud", tools: "desk"  }   // Remote Control 真形态；二期后半段
```

---

## 6. 目标架构

### 6.1 新进程 `neo-loop`

建议落点：`services/neo-loop/`（Maven / Gradle 单模块），**不要**塞进 `packages/` 的 pnpm workspace。TypeScript 包继续只给控制面和客户端用。

职责：

1. 接收控制面的 turn：`prompt` / `steer` / `follow_up` / `abort` / `set_model`。
2. 为该 Run 构造 `RuntimeContext(userId=run.userId, sessionId=runId)`，`IsolationScope.SESSION`。
3. `HarnessAgent.streamEvents(...)`，把事件译成 `RunEvent`，`POST /internal/runs/:id/events`。
4. 文件 / shell 经 `NeoSandboxFilesystemSpec` 打到该 Run 的执行器。
5. 云工具（`neo_git_commit` 等）继续走控制面 `/internal`，**不要**让沙箱里的 bash 持长期 git token。
6. 会话写 `AgentStateStore`（Redis 热、MySQL 冷），控制面不再备份 pi JSONL。

不职责：鉴权登录、开 PR、打盘、配额账本、SSE 给浏览器。这些仍在 `control-plane`。

### 6.2 `NeoSandboxFilesystemSpec`

官方允许自建沙箱店：实现 `Sandbox` + `SandboxFilesystemSpec`，`exec(command)` 是主数据面。Harness 的 `edit_file` / `grep_files` 都靠沙箱里跑 shell。

Neo 的实现不要自己再起 Docker：

| Runtime | `Sandbox.exec` 落到哪 |
| --- | --- |
| `local` / `vm` / `docker` / `firecracker` | 已有 worker 进程。worker **不再** `createAgentSession`，只暴露工具通道 |
| `desk` | Desk 工具执行器（[desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md) 要新做的那条双向流） |

最小 `Sandbox` 面：

```
exec(command, timeout, abort) → { stdout, stderr, exit_code }   // 必须支持流式 stdout
upload(relativePath, bytes)
download(relativePath) → bytes
exists / list
heartbeat()
abort(execId)
```

槽镜像要满足 AgentScope 的 POSIX 契约（`sh`、`python3`、GNU `stat -c`、`tar`、`base64`）。现网 Ubuntu 24.04 槽基本合格；`edit_file` 需要 `python3`，Build/`install` 里要保证有。

快照不要走 AgentScope 默认的「每 turn 打一份 workspace tar」。Neo 已有 Build 快照、warm slot、`WORKER_IDLE_RELEASE_MS` 写回。`snapshotSpec` 用 `NoopSnapshotSpec`，机器生命周期仍由 `Runtime` + [workspace-persistence.md](./workspace-persistence.md) 管。AgentScope 只存 **对话 / plan / MEMORY.md 指针**，不存整盘。

`IsolationScope` 必须是 `SESSION`（一个 Run 一个槽）。默认 `USER` 会让同一用户的两条对话抢一块盘。

### 6.3 跟进、steer、abort

pi 的三个动词要对到 AgentScope，不能再写第二套队列执行器。控制面 inbox 类型保持不变（`packages/contracts/src/worker.ts`），翻译放在 `neo-loop`：

| 控制面 | 现在（pi） | `neo-loop` |
| --- | --- | --- |
| IDLE + 新消息 | `session.prompt` | `streamEvents(UserMessage)`，同一 `sessionId` |
| RUNNING + 改方向 | `session.steer` | `abort()` 当前流 + 把 steer 文本当新 user 消息，或注入 HintBlock「忽略未完成计划，改做：…」 |
| RUNNING + 做完再做 | `session.followUp` | 先入队，等 `AgentEndEvent` 再 `streamEvents` |
| 取消 | `session.abort` | 取消 Reactor 订阅，并 `Sandbox.abort` 在途 exec |
| 换模型 | `set_model` | 下一 turn 换 Model 实例，session 不动 |

AgentScope 没有 `steer` 原语。第一期用「中止 + 带约束的新消息」近似；不要在控制面发明第四个队列。

### 6.4 系统提示、专家、技能

控制面物化保持原样：`.neo/EXPERT.md`、`.neo/skills/<slug>/SKILL.md`、`AGENTS.md`。

`neo-loop` 启动 turn 前：

1. 把工作区 `AGENTS.md` / `CLAUDE.md` / `.neo/EXPERT.md` 读进 `WorkspaceSpec`（经沙箱 `download`，或控制面在 bootstrap 里塞一份文本，避免为了读提示打一轮 RPC）。
2. SkillBox 增加根：`.neo/skills`、`.cursor/skills`、`.agents/skills`（与 `createWorkspaceLoader` 对齐）。不要只认 `workspace/skills/`。
3. 云端边界提示（禁止交互 sudo、用 `neo_*` 提交）改成 AgentScope `onSystemPrompt` middleware，对应现在 `CLOUD_SYSTEM_PROMPT`。

专家工具白名单：现在 `intersectSessionTools` 在 worker。搬到 loop 的 Toolkit 过滤；执行器再强制一遍（loop 被 prompt injection 拿下时，执行器是第二道墙）。

### 6.5 云工具放哪

| 工具 | 放哪 | 原因 |
| --- | --- | --- |
| `read` / `edit` / `bash` / `grep` / … | 沙箱 / 执行器 | 必须碰盘 |
| stdio MCP | 执行器 | 进程和 cwd 在机器上 |
| HTTP MCP | 控制面代理（现有 `/internal/runs/:id/mcp`） | 密钥不进执行器，也不进 loop |
| `neo_git_commit` / `neo_pr_open` | loop 里的 schema 工具 → 控制面 | 签名和 push 从不进 bash |
| `neo_memory_*` | loop → 控制面 | 已是旁路，Mem0 密钥不进 VM |
| `neo_artifact_upload` | 执行器读文件 + 控制面收 | 对位 `deliver_artifact`，但走现有签名 URL |
| `neo_browse` | loop 或控制面 | 不碰用户盘；仍受 egress |
| `neo_subagent` | loop 内嵌套 `HarnessAgent`，**共享同一 `NeoSandbox`** | 不要占第二槽；不要把子 loop 打回控制面 |
| `neo_diag` / `neo_subscribe` | 控制面 | 诊断和 webhook 本来就不在盘上 |

### 6.6 工具 RPC 协议

现在 worker ↔ 控制面是「inbox 轮询 400ms + POST events」。这不够当工具通道。loop ↔ 执行器必须新做一条：

- 双向、带 `callId`、可并发、可流式、可 abort。
- 现网 Caddy 已为 SSE 配 `flush_interval -1`。第一期用 **WebSocket 或 HTTP/2 双向流**；不要把工具调用塞进现有 inbox。
- 鉴权：执行器只认 **run JWT + 该 Run 的 lease**。Desk 路径还要 desk token，run JWT **不能单独**成为本机 bash 凭据（[desk-phase2-tool-rpc.md §4.3](./desk-phase2-tool-rpc.md)）。
- 沙箱根、路径逃逸、egress，全部在执行器强制。loop 侧的 PermissionEngine 是产品审批，不是安全边界。

控制面可以当信令（谁连谁、lease、恢复），但 **工具 payload 不要绕一圈进 orchestrator 业务线程**。

### 6.7 状态机几乎不动

```
NOT_YET_STARTED → PROVISIONING → INSTALLING → RUNNING ⇄ IDLE
```

变化只有「谁在 RUNNING」：

| 以前 | 以后 |
| --- | --- |
| worker 进程活着且 pi 在 turn | `neo-loop` 有一个未结束的 `streamEvents` |
| IDLE 卸槽 = 会话也走了（靠 JSONL 备份恢复） | IDLE 可以卸槽；loop 进程无 per-run 常驻状态；跟进时再 claim 槽，用同一 `sessionId` 恢复对话 |
| 心跳 = worker 活着 | 拆成 **loop 活着** 和 **工具通道活着**。只有工具通道掉线时标 detach / 排队，不要立刻 ERROR |

`WAITING_FOR_BACKGROUND_WORK` 留给 AgentScope 后台子代理。后台子代理默认共享父沙箱；要并行机器时再申请第二槽，配额走现有 `GET /v1/quota`。

---

## 7. 事件怎么映射

UI 继续吃 `RunEvent`。不要让对话页感知 AgentScope 的 28 种事件。

| AgentScope | `RunEvent.kind` | 注意 |
| --- | --- | --- |
| `AgentStartEvent` | `agent.start` | 子代理带 `subagentId`，父层不要再发一条 |
| `TextBlockDeltaEvent` | `message.delta` | 按 `replyId`/`blockId` 聚合 |
| 文本块开始 / 结束 | `message.start` / `message.end` | 工具后的下一段文字仍按现有 transcript 规则新开气泡 |
| `ToolCallStartEvent` | `tool.start` | `toolName` 用 Harness 名，UI 可显示 `read_file`；或在 loop 里别名回 `read` |
| exec 流式 stdout | `tool.update` | 现在 bash 有，丢掉会觉得「卡住」 |
| `ToolResultEndEvent` | `tool.end` | `isError` 看 exit_code / state |
| token 用量 | `llm.usage` | Gateway 已按 run JWT 打点，loop 再报一份要去重或只信 Gateway |
| `RequireUserConfirmEvent` | 新 kind 或复用 `followup.queued` | 第一期只给 Desk；Web 云端 Run 默认 allow 白名单内工具 |
| `AgentEndEvent` | `agent.end` | 仍表示**一回合结束**，不要把中间每一轮 LLM 当成 turn 结束（pi 现在就踩过这个坑，见 `packages/worker/src/events.ts`） |

`workerSeq` 改名叫什么都行，但必须由 **loop** 单调递增。执行器推的碎片进 loop 后再盖章。

---

## 8. 分期

不要「先把 Java 引进来再看怎么接」。按能独立验收的切片切。

### 第 0 期 — 对齐认知，改文档锁（本 PR）

- 本文进仓库。
- 若接受路径 C：下一份实现 PR 再改 `architecture.md` §2 / §17.5，以及 overview「还没有」那一行。
- 不改运行时代码。

### 第 1 期 — 工具通道，内核仍是 pi

先把「loop 和工具可拆」做成事实，再换 loop。否则 Java 和协议一起炸，分不清是谁的错。

1. 在 contracts 增加执行器协议（`callId`、流式、abort）。
2. worker 增加 `WORKER_ROLE=all|tools`。`tools` 模式不打开 pi，只接 exec / 读文件。
3. 控制面仍把 loop 放在**同一个** worker 进程里，但文件工具走内存里的同一条协议（loop 调自己）。这是为了先固定事件序和 abort。
4. 单测：`bash` 流式、`abort` 杀掉在途命令、路径逃逸仍被 `NEO_SANDBOX_ROOT` 拦住。

验收：`AGENT_KERNEL=pi` 的现网行为零变化；`WORKER_ROLE=tools` 的 worker 能被测试 harness 远程 exec。

### 第 2 期 — `neo-loop` 最小闭环

新进程 + `HarnessAgent` + `NeoSandboxFilesystemSpec` 打第 1 期的通道。

1. 模型只打 Gateway，mock 上游就能 IDLE。
2. 只开云端 `loop=cloud, tools=cloud`。Desk 不动。
3. 映射 `streamEvents` → `RunEvent`；跟进用「IDLE 再 prompt」。steer / 后台子代理不做。
4. `AGENT_KERNEL=agentscope` 仅开发 / 单测。现网默认 pi。
5. 应用机再加一个 systemd unit。堆上限单独设（建议 512MiB），和槽进程分开。现网 4G 要重新算：2×512 worker + 512 loop + control-plane + gateway，余量很紧——**第 2 期不要在现网默认开**，先在 `WORKER_RUNTIME=local` 验证。

验收：`POST /v1/runs` + toy-repo「写 README 并跑 test.sh」在 mock 上游走到 IDLE；对话页工具卡和文字顺序与 pi 路径一致。

### 第 3 期 — 跟进、备份、卸槽解耦

1. follow_up 队列、steer 近似、abort 同时取消 LLM 和 exec。
2. `AgentStateStore` 接 Redis / MySQL。控制面重启后，IDLE Run 跟进不再下载 pi JSONL。
3. IDLE 卸槽只丢机器、不丢 loop 会话。跟进时重新 provision，sandbox 连到新槽，sessionId 不变。
4. 心跳拆成 loop / tools 两路。

验收：卸槽后再跟进，对话上下文还在，工作区从写回盘恢复；控制面重启不丢 IDLE。

### 第 4 期 — Desk Remote 变成真云 loop

解开 `assertColocatedTarget`。`{ loop:"cloud", tools:"desk" }` 走同一条 `NeoSandbox`，执行器换 Desk。

权限按 [desk-phase2-tool-rpc.md §4.3](./desk-phase2-tool-rpc.md) 做完再解禁：Desk 侧沙箱、逐次校验、run JWT 单独不够。This Computer（`loop=desk`）可以继续本机 pi，或本机 JVM；**不要**为了统一强行让笔记本装 JRE。

验收：NAT 后笔记本只出向；loop 升级不重打 Desk 安装包；匹配失败 fail closed，不回落云端盘。

### 第 5 期 — 可靠性（可选，且别自研 Temporal）

AgentScope 的 store + 短 turn 已经能扛进程轮转。真要跨天、跨节点、推理闪断重放，再评估 Temporal / 国产工作流，把 **一个 turn** 做成 workflow，activity =「一次模型调用」和「一次工具调用」。不要一条 Run 一个永远活着的 workflow（Cursor 已经从这条退回来了）。

现网单机轻量不必上 Temporal。

---

## 9. 包、进程、现网怎么改

### 9.1 仓库

```
neo-cloud-agent/
  packages/                 不动：TS 控制面 / 客户端 / 现有 worker
  services/neo-loop/        新增：Java 21+，AgentScope 2.0
    src/main/java/cloud/neorun/loop/
      LoopServer.java
      PiCompatEvents.java          # AgentEvent → RunEvent
      FollowUpTranslator.java
      sandbox/NeoSandboxFilesystemSpec.java
      sandbox/WorkerSandboxClient.java
      tools/NeoCloudTools.java     # git / pr / memory / mcp 代理
  infra/                    neo-loop.service + 健康检查
```

一个 monorepo 仍然成立。不要为 Java 另开仓库。CI 加 `./mvnw -q test`，和 `pnpm test` 并列。

### 9.2 现网拓扑（第 2 期之后）

应用机 `62.234.211.200`：

| 进程 | 端口 | 第 2 期默认 |
| --- | --- | --- |
| Caddy | 443 | 不动 |
| control-plane | 8080 | 不动 |
| llm-gateway | 8081 | 不动 |
| admin-api | 8090 | 不动 |
| neo-loop | 8082（仅内网） | **先关。** 打开前先加内存或减槽 |
| 2 × loop 槽 | — | worker 改 `tools` 角色之后才能给 AgentScope 用 |

库机不动。`neo-loop` 用同一套 `DATABASE_URL` / `REDIS_URL`，另起 key prefix（`loop:`），不要和 Run 事件 stream 抢 key。

4C/4G 的硬约束：路径 C 在现网默认开启之前，必须能回答「两槽满载 + loop JVM + 一次 Pro 推理」会不会 OOM。答不上就只在 local / 更大宿主开。

### 9.3 开关

```
AGENT_KERNEL=pi            # 默认。现网保持
AGENT_KERNEL=agentscope    # 开发 / 金丝雀
NEO_LOOP_URL=http://127.0.0.1:8082
WORKER_ROLE=all            # 兼容旧镜像
WORKER_ROLE=tools          # 只当沙箱
```

按 Run 覆盖：`CreateRunRequest.kernel` 可选，便于同一账号对比 pi / AgentScope。不要做全局隐式切换。

---

## 10. 风险

| 风险 | 为什么严重 | 怎么收 |
| --- | --- | --- |
| 工具 RPC 延迟 | coding 一回合 10–100 次调用 | 并发在途、流式、同机 Unix socket（槽和 loop 都在应用机时） |
| 丢掉 bash 流式 | 用户以为挂了 | 第 1 期就把 `tool.update` 写进协议 |
| `edit_file` 依赖 `python3` + GNU stat | Alpine / 瘦镜像会哑失败 | 槽镜像 conformance 检查进 Build |
| steer 语义变差 | AgentScope 无原语 | 先文档化近似，再看要不要 middleware |
| 双内核长期分叉 | 专家 / 技能 / hooks 只在一边亮 | 物化仍在控制面；loader 测两边 |
| 现网 OOM | 4G 上第四个 JVM | 第 2 期不切现网默认 |
| 事件乱序 | 执行器直接推 CP | 只允许 loop 写 `RunEvent` |
| Prompt injection 打穿笔记本 | `loop=cloud, tools=desk` | 第 4 期权限做完再解 `assertColocatedTarget` |
| 把 AgentRun 当捷径 | 执行面换成阿里云，Neo 的槽和 Desk 全废 | 方案写死：自建 `NeoSandbox` |
| 用 AgentScope Channel 接微信 | 和第二套 inbox | IM 仍走 `packages/control-plane/src/ingress` |

---

## 11. 明确不做

1. 不把 `HarnessAgent` 嵌进 `control-plane`。
2. 不 fork AgentScope 加 Neo 业务。云功能走 `NeoCloudTools` + 控制面 `/internal`。
3. 不把 Provider Key、SCM 私钥、Mem0 key 配进 `neo-loop`。
4. 不在第 1–3 期解 `loop !== tools`。
5. 不把 CLI / 手机改成本机 Agent。
6. 不引入 Nginx、不把 New API 提升成 Neo 进程。
7. 不为 Java 另开 Git 仓库。
8. 不把「换了 AgentScope」写成产品卖点。用户看见的还是 Neo Run。

---

## 12. 和已有文档的关系

| 文档 | 关系 |
| --- | --- |
| [architecture.md](./architecture.md) §2 / §17.5 | 一期锁。采纳路径 C 后改写成「loop 独立进程，工具在执行面」 |
| [architecture-overview.md](./architecture-overview.md) | 实现落地后再改包地图、进程数、主路径时序 |
| [desk-phase2-tool-rpc.md](./desk-phase2-tool-rpc.md) | 第 4 期的权限和协议工作仍有效。AgentScope 不替代那份报告 |
| [workspace-persistence.md](./workspace-persistence.md) | 机器生命周期仍归 Runtime。不要改成 AgentScope 每 turn 打 tar |
| [agent-memory-research.md](./agent-memory-research.md) | 跨 Run 记忆仍是控制面旁路 + Mem0。Harness 的 `MEMORY.md` 只做本 Run 工作区记忆，不要两套用户记忆 |
| [browser-computer-use.md](./browser-computer-use.md) | computer-use 仍是专职子代理 + 环境里的浏览器，不摊到主 Toolkit |

---

## 13. 第 2 期验收清单（实现 PR 用）

- [ ] `services/neo-loop` 能在 mock Gateway 下对 `fixtures/toy-repo` 跑完一轮到 IDLE
- [ ] 对话页 transcript：工具组在最终答复上面，`workerSeq` 不乱
- [ ] `GET /v1/runs/:id/transcript` 与 pi 路径同一套 snapshot 函数
- [ ] 执行器杀进程后，loop 把 Run 标 ERROR 或可恢复，不把控制面卡死
- [ ] abort 能停在途 `execute`
- [ ] 工作区逃逸（读 `/etc/passwd`、写槽外路径）被执行器拒绝
- [ ] Gateway 日志里只有 run JWT，没有 Provider Key
- [ ] `AGENT_KERNEL=pi` 的 `pnpm test` 全绿
- [ ] 现网默认仍是 pi；文档写明如何金丝雀

---

## 14. 一句话给决策用

> 学 Cursor，学的是「loop / 机器 / 对话」三态拆开，不是学「在控制面嵌一个 Java Agent」。AgentScope Java 适合当 **第四个进程里的 loop**，用官方沙箱 SPI 驱动已经存在的 Neo worker。pi 先留着。现网 4C/4G 没加内存之前，不要切默认内核。
