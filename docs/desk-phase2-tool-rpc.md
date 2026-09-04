# 二期：云端 loop + 本机工具 RPC

调研报告 + 影响范围评估。2026-08-27，代码基线 `main` `4d35d9e`。

对照文档：[desk.md](./desk.md)（现状）、[architecture.md §2](./architecture.md)（一期锁死的原则）、[desk-project-design.md](./desk-project-design.md)。

---

## 0. 结论先行

1. **Cursor 的 Remote Control 确实是云端 loop + 本机工具 RPC。** 官方文档三处明说：*"Cursor runs the agent loop, inference, and planning. Your worker performs file edits and terminal commands."* 我们一期没抄这个，抄的是它的出向长连接 + 严格匹配。
2. **pi 官方就留了远程工具接缝**，而且是三层。一期 [architecture.md §2](./architecture.md) 写的「你等于丢掉 pi，自己重写一个远程执行器」**在 pi 0.84.2 上已经不成立**。这条论据要改。
3. **但 §2 的另一条论据仍然成立**：延迟。每个 `read` / `bash` 都要一次往返，这条不会因为有接缝而消失，只能靠工程手段压。
4. **二期不是「让远程派活可用」——那个一期已经能用了**（desk loop + desk tools + dispatch）。RPC 买到的是另外三件事：loop 升级不用重打安装包、云端上下文管理、和 Cursor 形态对齐。这一点必须在动手前对齐认知，否则会为了架构纯洁性付出一个新子系统的代价。
5. **最大风险不是延迟，是权限。** 今天沙箱跑在 worker 进程里（`NEO_SANDBOX_ROOT`）。loop 一旦搬到云端，沙箱必须搬到 Desk 侧，否则**一个泄漏的 run JWT 就等于笔记本上的任意命令执行**。这是二期的第一个必做项，不是收尾项。
6. 影响范围：**约 15–25 个文件实质改动 + 1 个新子系统（Desk 工具执行器）+ 1 条新协议（双向、可流式、可关联）**，横跨 contracts / worker / extensions / desk / control-plane / web，外加一整轮文档反转。

---

## 1. Cursor 的技术方案

### 1.1 This Computer（本机 Agent）

| 项 | 事实 |
| --- | --- |
| loop 在哪 | **客户端进程内**。SDK 文档：*"Runs the agent loop inline in your Node process. Files come from disk."* |
| 推理在哪 | **永远在 Cursor 云端**。*"'Local' describes where the agent loop and filesystem access run, not where the model runs."* 没有本地模型路径 |
| 云端有没有会话对象 | **没有**。官方论坛员工原话：*"A plain 'This Mac' session lives entirely inside your desktop app, with no cloud-side representation."* |
| 工作区 | **就地改打开的 checkout**。worktree 是显式 opt-in（`/worktree`），每机上限 25 个 |
| 审批 | **只有本机 Agent 有**。Run Modes（Auto-review / Allowlist / Run Everything）+ macOS Seatbelt / Linux Landlock 沙箱 |

关键对比点：**Cursor 的本机 Agent 和我们的 This Computer 是同一个形态**——loop 在本地、推理在云、就地改盘、没有云端 loop。我们一期做对了。

### 1.2 Remote Control / My Machines

| 项 | 事实 |
| --- | --- |
| loop 在哪 | **Cursor 云端**（文档三处明说，含 runtime 对比表） |
| 工具在哪 | **你的机器**。文件编辑、终端命令、computer-use、stdio MCP |
| 穿 NAT | 机器**出向**拨一条长连接到云。*"Cursor never connects into your network."* 无入向端口、无公网 IP、无 VPN |
| 传输 | **HTTP/2 流**，帧 + 心跳。有 HTTP/1.1 回退（`network.useHttp1ForAgent`），因为部分企业代理不支持 HTTP/2 双向流 |
| 出网白名单 | `api2.cursor.sh`、`api2direct.cursor.sh`（会话必需）；产物直传 S3 |
| MCP 拆分 | **stdio 跑你机器，HTTP/SSE 跑 Cursor 后端**。这条最能反证 loop 在云端 |
| 登记什么 | workerId、机器名（默认 hostname）、一个或多个 `--worker-dir` 根、从 git remote 推出的 `repo=owner/name` 标签，**以及 `workspaceRootPath` 绝对路径** |
| 同意模型 | **绑定即授权**。用个人凭据启动 worker 即授权，没有逐条审批 |
| 匹配失败 | **fail closed**，明确报错，**不回落云端** |
| 会话身份 | 本机会话续到云端时**复用 composer id**：`8e6babe6…` → `bc-8e6babe6…`，原本机记录标 `isArchived` |
| 硬限制 | 机器必须**保持唤醒在线**（官方列为 Remote Control 唯一当前限制）；10 workers/人、50/团队 |

### 1.3 两个必须标注为"未确认"的点

- **BYOM worker 上到底还有没有工具审批。** 文档说 Cloud Agents 不走 Run Modes，而 My Machines 的 run *就是* Cloud Agent —— 推论是**在你自己笔记本上无人值守执行**。但第三方资料和 SDK 的 `"request"` 状态又暗示存在审批。**这是本次调研最高风险的未知项**，直接决定我们二期要不要做逐条审批。
- **RPC 协议本身**。公开信息只有 "HTTP/2 session"、"frame"、"heartbeat"。不要假设 gRPC / Connect / WebSocket。

另外两个 2026-08 仍未修的官方已确认 bug，直接影响"一台机器绑多个仓库"的设计假设：

- **一台机器同时只有一个 Remote Control workspace 能用**（员工 2026-08-10 确认，非预期行为）。
- **CLI `worker.lock` 是全局独占锁**，导致「每个仓库起一个 worker」的官方指引实际做不到。

---

## 2. 和我们现在的对比

| 维度 | Cursor This Computer | **我们 This Computer（现状）** | Cursor Remote Control | **我们 Remote control（现状）** |
| --- | --- | --- | --- | --- |
| loop | 客户端 | **Desk 本机 worker** | 云端 | **Desk 本机 worker** |
| 工具 | 本机 | **本机** | 本机（RPC） | **本机（同进程）** |
| 推理 | 云 | **云（LLM Gateway）** | 云 | **云（LLM Gateway）** |
| 云端会话对象 | 无 | **有**（会话权威在控制面） | 有 | **有** |
| 穿 NAT | 不需要 | 不需要 | 出向 HTTP/2 | **出向 SSE inbox**（`GET /v1/desks/:id/inbox`） |
| 登记路径 | — | — | **上报绝对路径** | **只报机器名 + repoKey**，绝对路径不上云 |
| 同意模型 | Run Modes 逐条 | 授权目录 + 沙箱 | 绑定即授权 | **绑定即授权 + 默认关的远程开关 + 可选逐条确认** |
| 匹配失败 | fail closed | — | fail closed | **fail closed**，四种明确文案 |
| 进程寿命 | 长驻（推测） | **一回合一进程**（`WORKER_EXIT_AFTER_TURN`） | 长驻 | **一回合一进程** |
| 工作区 | 就地 | **就地** | 就地（推测） | **就地** |

三处我们比 Cursor 严格，二期要**保住**，不要为了对齐而放弃：

1. **绝对路径不上云。** Cursor 的 `workspaceRootPath` 是 API 可读的；我们只报 `机器名 · 仓库名`。
2. **远程开关默认关。** Cursor 是绑定即可被派活；我们多一道 This Computer / Remote control 的显式分离。
3. **一回合一进程。** 解决了 JWT 过期、槽位占用、界面状态三个真故障（见 [desk.md](./desk.md)）。

一处我们比 Cursor 弱，二期会更明显：

- **一台机器同一时刻只有一个本机 worker 在改盘。** Cursor 个人 worker 允许多 agent 并行。工具改 RPC 后，并发压力会从"一个 worker 进程"变成"一个工具执行器要服务 N 条云端 loop"。

---

## 3. pi 完整调研

### 3.1 是什么

| 项 | 值 |
| --- | --- |
| 上游 | [earendil-works/pi](https://github.com/earendil-works/pi) |
| 集成方式 | **npm 依赖**，未 vendor、非 git dep |
| 版本 | **0.84.2**（`packages/worker/package.json` + lockfile 锁定） |
| 直接依赖 | `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai` |
| 传递依赖 | `pi-agent-core`（loop + 工具分发）、`pi-client` / `pi-protocol`（远程会话，**我们没用**）、`pi-tui` |
| 我们怎么用 | **进程内嵌**（`createAgentSession`），不起 pi CLI，不用它的 JSONL RPC 模式 |

入口是 `openPiSession()`（`packages/worker/src/session.ts:39`）。

### 3.2 工具契约

```ts
// pi-agent-core: 运行时工具
execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>
executionMode?: "sequential" | "parallel"

// pi-coding-agent: SDK / 扩展工具
execute(toolCallId, params, signal, onUpdate, ctx) => Promise<AgentToolResult>
```

| 方面 | 行为 |
| --- | --- |
| Schema | TypeBox，执行前校验 |
| 中断 | `AbortSignal` 传进 `execute`，bash 遵守 |
| 增量输出 | `onUpdate(partial)` → `tool_execution_update`（bash 约 100ms 节流） |
| 并发 | 默认 parallel，可按工具声明 sequential |
| 执行前闸门 | `beforeToolCall` / 扩展 `tool_call` 可 `{ block: true, reason }` |
| 执行后 | `afterToolCall` / `tool_result` 可改写内容与 `isError` |

内置 7 个：`read` `bash` `edit` `write` `grep` `find` `ls`。我们加 9 个：`neo_git_commit` `neo_pr_open` `neo_diag` `neo_artifact_upload` `neo_browse` `neo_mcp_list` `neo_mcp_call` `neo_subagent` `neo_subscribe`（`packages/extensions/src/`）。

我们的 9 个里**已经有 6 个本质上是 RPC**（走 `callControlPlane` 打控制面）。真正需要本机的是 pi 那 7 个内置工具，加上 `neo_artifact_upload` 的读文件、`neo_diag` 的读本地日志、`neo_mcp_*` 的 stdio。

### 3.3 关键发现：pi 官方留了三层远程接缝

这是本次调研对二期决策影响最大的一条。逐工具的 `*Operations` 接口，注释是 pi 自己写的：

```ts
/**
 * Pluggable operations for the read tool.
 * Override these to delegate file reading to remote systems (for example SSH).
 */
export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

export interface BashOperations {
  exec: (command: string, cwd: string, options: {
    onData: (data: Buffer) => void;   // ← 流式，天然映射 onUpdate
    signal?: AbortSignal;             // ← 中断可透传
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  }) => Promise<{ exitCode: number | null }>;
}
```

七个内置工具都有对应的 `ReadOperations` / `WriteOperations` / `EditOperations` / `BashOperations` / `GrepOperations` / `FindOperations` / `LsOperations`。

三层接缝，按干净程度排序：

| 层 | 入口 | 说明 |
| --- | --- | --- |
| **A. `baseToolsOverride`** | `AgentSessionConfig.baseToolsOverride?: Record<string, AgentTool>` + `createAgentSessionFromServices` | 整体替换内置工具。注释：*"useful for custom runtimes"*。**最干净**：工具名、prompt 贡献、渲染都还是 pi 原生 |
| **B. `createXToolDefinition(cwd, { operations })`** | 从包根导出：`createReadToolDefinition` … `createBashToolDefinition`、`ToolsOptions`、`withFileMutationQueue`、`createLocalBashOperations` | 保留 pi 的截断 / 差异 / 图片处理逻辑，只把最底层 IO 换成 RPC。**推荐** |
| **C. `customTools` + `noTools: "builtin"`** | `createAgentSession`（我们今天就在用 `customTools`） | 自己实现 7 个同名工具。**不要走这条**：会丢掉 pi 的截断、edit diff、图片缩放、文件互斥队列 |

注意：`createAgentSession` 的 `CreateAgentSessionOptions` **不暴露** `ToolsOptions`。走 B 就要把内置工具从 `tools` 里摘掉、以 `customTools` 注册注入过 operations 的定义；或者走 A 换 `createAgentSessionFromServices`。这是一个真实的实现约束，不是理论问题。

**结论：二期不是重写执行器，是给 7 个内置工具换 IO 后端。** [architecture.md §2](./architecture.md) 里「等于丢掉 pi」那句要删。

### 3.4 pi 里假设"工具在本地"的地方

| 假设 | RPC 后的影响 |
| --- | --- |
| `withFileMutationQueue` 同文件串行 | 进程内互斥。远端要自己保序，否则并发 edit 同一文件会乱 |
| bash 截断输出落本地临时文件（`fullOutputPath`） | 这个路径在远端机器上，云端 loop 拿不到；details 要改语义 |
| `read` 可返回 `ImageContent` | 二进制要编码过网 |
| 会话头记录 `cwd` | 云端 loop 的 cwd 和远端工作区路径不是一回事 |
| 并发工具结果顺序 | pi 按完成顺序发 `tool_execution_end`，按源顺序生成 toolResult 消息。RPC 要保住这个区别 |
| `neo_subagent` 进程内起嵌套会话 | 嵌套会话继承工具位置 → **RPC 流量按 N 工具 × M 子代理放大** |

---

## 4. 把 tool 调用改成 RPC：影响范围

### 4.1 现在被锁住的地方

```ts
// packages/contracts/src/run.ts:102
export function assertColocatedTarget(target: ExecutionTarget): void {
  if (target.loop !== target.tools) {
    throw new Error("P0–P2 只允许 loop 与 tools 同址");
  }
  if (target.tools === "desk" && !target.deskId) {
    throw new Error("本机执行需要 deskId");
  }
}
```

好消息：`ExecutionTarget` 一期就是**两轴**设计，注释写着"a later cloud loop + desk tools combo does not rewrite the contract"。契约不用重写。

坏消息：`isDeskTarget()` 要求 `loop === "desk" && tools === "desk"`，而它在 orchestrator 里被用了约 20 次，把**三件不同的事捆成一个判断**：loop 在哪、工具在哪、desk 生命周期。二期要拆成 `isDeskToolsTarget` / `isCloudLoopTarget`，然后逐个 call site 重判。这是本次改动里最容易出错的部分——每个点都要问"这里想问的到底是哪一轴"。

强制点只有两处（`createRun`、`handoffRun`），但语义点是那 20 处。

### 4.2 现有传输机器够不够

| 现有 | 形态 | 能不能扛工具 RPC |
| --- | --- | --- |
| Desk inbox SSE | **单向 CP→Desk**，只有 `assignment` / `cancel` / `ping`，15s 心跳 | **不够**。没有请求关联 id、没有反向流 |
| lease / claim / release | 生命周期，`waitMs` 默认 20s | 只管派单，不管调用 |
| worker ↔ CP | **两条半双工 HTTP**：worker 轮询 inbox（400ms）+ 推事件 | **不够**。400ms 轮询做工具调用，一个回合 50 次工具就是 20s 纯等待 |
| Desk 本机 IPC（term / files） | 有流式（`desk:term-data`）、有状态（shells Map） | 是**实现工具执行器的素材**，不是过网协议 |

**缺口很明确：没有任何现成通道能承载"云端发起 → 本机执行 → 结果回流（含中途流式）"。** 这条协议必须新做。

Cursor 用 HTTP/2 双向流。我们的现网是单台轻量 + Caddy，HTTP/2 反代双向流可行，但要注意 Caddy 的 `flush_interval -1` 已经为 SSE 配好，双向流要另测。

### 4.3 权限：二期第一个必做项

今天的沙箱在 worker 进程里：

```
packages/desk/src/spawn.ts:66      NEO_SANDBOX_ROOT: input.workspaceDir
packages/worker/src/config.ts:31   读成 config.sandboxRoot
packages/worker/src/sandbox.ts:123 pi.on("tool_call") → 逃出根就 block
```

loop 搬到云端后，这段代码就在**错误的一侧**。必须落在 Desk 工具执行器里。

同时要新增授权层。今天 run JWT 能做的事只限于"这条 run 的控制面 API"。二期它会变成"在用户笔记本上执行 bash"的凭据。所需检查：

1. Desk 侧对**每一次**工具调用校验 `{ runId, deskId, workspaceId, toolName, args }`，desk token 太粗。
2. run JWT **不能单独**成为调用本机工具的凭据。
3. 沙箱 + 工具白名单在 Desk 侧强制。
4. 工具 RPC 限流。

**爆炸半径：任何能创建 `{ loop: "cloud", tools: "desk" }` 的客户端，都获得了在那台笔记本上执行命令的能力，而且不需要人在机器前面。** 这和今天"人点了 This Computer 才起进程"是两个安全模型。

Cursor 这块也没有公开的 worker 侧沙箱——`--worker-dir` 只是"expose 给 agent 的根"，没有强制机制文档。**我们不要抄这个空白**，我们现有的沙箱是优势。

### 4.4 正确性与延迟

| 项 | 二期影响 |
| --- | --- |
| 事件顺序（`workerSeq` / `workerEpoch`） | 工具事件必须**仍由云端 loop 统一盖章**。Desk 直接往 CP 推工具事件会和 loop 的 message delta 乱序 |
| `tool.update` 流式 | bash 增量必须低延迟过网，否则体感明显差于本地 |
| 一回合一进程 | 云端 loop 可以按回合退；但 Desk 执行器可能要跨回合活着，才能保住热 bash / stdio MCP。**这是新的生命周期决策** |
| 会话备份 | JSONL 跟着 loop（云端）；Desk 只有文件系统状态。恢复时两边要对得上 |
| abort | 要**同时**取消云端 LLM 流和在途的 Desk 工具 RPC |
| 心跳 | 现在只有一个"worker 活着"。二期要分成 **loop 活着** 和 **工具通道活着** 两个独立判断 |
| `gitCwdFor` | 已知问题（`orchestrator.ts:2120`）：控制面看不到 Desk 文件。git 工具要整体落到 Desk 侧 |
| 出网策略 | 云端 loop 的 `neo_browse` 仍受 egress 管；但 **Desk 上的 `bash curl` 绕过云端 egress**。策略要在 Desk 侧重述 |
| 子代理 | 嵌套会话把 RPC 流量乘以子代理数。要先定"子代理的工具跑哪"的策略 |

延迟量级：一个 coding 回合 10–100 次工具调用。控制面在北京轻量、用户笔记本在国内，RTT 20–50ms 量级，折算每回合增加约 0.2–5s，可接受。但要注意这是**串行往返**——pi 默认并发执行工具，协议必须支持并发在途调用，否则延迟会线性累积。

### 4.5 分包爆炸半径

分级：**S** 小改 / **M** 实质改动 / **N** 新子系统

| 包 | 级别 | 要点 |
| --- | --- | --- |
| `packages/desk` | **N + M** | **新增工具执行器**（pi 7 内置 + 沙箱 + hooks + stdio MCP + 本机 git）。`app/host.ts` 路由工具调用 + 执行器生命周期；`src/spawn.ts` 起执行器而非整个 worker；`src/inbox.ts` 新事件类型 |
| `packages/control-plane` | **M** | `orchestrator.ts` 拆分目标的 provisioning、替换 20 处 `isDeskTarget`、bootstrap / git / diag；`api/server.ts` 工具 RPC 路由 + 鉴权；`security/auth.ts` 新令牌 |
| `packages/worker` | **M** | `session.ts` 注入 RPC operations（接缝 A 或 B）；`sandbox.ts` / `hooks.ts` 迁到 Desk 侧；`boot.ts` 工具远程时不在云端跑 install/start；`images.ts` 图片要落到 Desk；`subagent.ts` 工具位置策略 |
| `packages/extensions` | **M** | `neo-git` / `neo-pr` / `neo-artifact` / `neo-diag` / `neo-mcp` 拆本地与远程；`neo-browse` 留云端 |
| `packages/contracts` | **M** | 放开 `assertColocatedTarget`、加 `isDeskToolsTarget` / `isCloudLoopTarget`、`desk.ts` 加工具调用信封 |
| `packages/web` | **S–M** | 目标选择器加「云端大脑 + 本机手脚」模式 |
| `packages/llm-gateway` | **S** | 无结构变化 |
| `packages/mobile` / `cli` / `ui` | **S** | 文案与目标类型 |
| 文档 | **M** | [architecture.md §1 非目标 / §2 原则](./architecture.md)、[architecture-overview.md](./architecture-overview.md)、[desk.md](./desk.md)、[desk-project-design.md](./desk-project-design.md)、README、AGENTS.md 全要反转 |

测试：`contracts/src/run.test.ts`（同址断言要改）、`orchestrator.test.ts`（约 15 条 desk 测试 + 一整套新的拆分目标测试）、`transcript.test.ts`（RPC 延迟下的排序）、`worker/src/sandbox.test.ts`（迁到执行器）、`desk/src/inbox.test.ts`、`extensions/src/tools.test.ts`。

---

## 5. 建议的实施顺序

不要先写协议。先把不可逆的两件事定下来。

| 阶段 | 内容 | 为什么排这个位置 |
| --- | --- | --- |
| **0. 决策对齐** | 明确二期真正要买什么（loop 热更新？云端上下文？形态对齐？）。如果只是"网页能派活"，一期已经有了 | 避免为架构纯洁性付一个新子系统 |
| **1. 沙箱先搬** | 把 `sandbox.ts` + `hooks.ts` 做成 Desk 侧可独立运行的模块，**在 loop 还在本地时就搬**，用现有 desk run 验证 | 这是安全底座。搬之前不要开任何云端 loop 通道 |
| **2. 协议契约** | 定工具调用信封：关联 id、并发在途、流式分片、取消、超时、鉴权。先写 contracts + 测试，不接真实传输 | 协议错了后面全白做 |
| **3. 工具执行器** | Desk 侧起执行器，先用**本地 loop 打本地执行器**（同机回环）跑通七个内置工具 + 沙箱 + 流式 bash | 回环能把协议问题和网络问题分开 |
| **4. 接缝注入** | `session.ts` 走 pi 接缝 A/B，把 operations 换成 RPC 客户端。仍在同机验证 | 这步能证明"不用重写 pi" |
| **5. 过网** | 真正把 loop 放云端 VM，走 CP 中转或直连。补心跳双轴、abort 双端、事件盖章 | 网络问题单独一轮 |
| **6. 目标拆分** | 放开 `assertColocatedTarget`，重判 20 处 `isDeskTarget`，UI 加模式 | 最后开门，前面都没通不要开 |
| **7. 文档反转** | 改 §2 原则并写清"为什么当初锁、现在为什么解锁" | 不要留下自相矛盾的锁定文档 |

---

## 6. 必须先回答的问题

1. **二期到底要买什么？** 见上。这决定要不要做，不是怎么做。
2. **Desk 执行器跨回合活着吗？** 活着能保热 bash / stdio MCP，但破了"一回合一进程"带来的三个好处。
3. **子代理的工具跑哪？** 全部 RPC 会放大流量；留本地则同一条 run 里出现两种工具位置。
4. **一台机器服务几条云端 loop？** 今天是"一个 worker 改盘"。RPC 后并发模型要重定。
5. **要不要做逐条审批？** Cursor 这块是空白且未确认。我们已有"每次确认"开关，二期无人值守执行会让它更重要。
6. **绝对路径继续不上云吗？** 建议保住。工具 RPC 用 workspaceId 寻址，路径解析留在 Desk 侧。

---

## 7. 明确不做

- 不抄 Cursor 的 `workspaceRootPath` 上报。
- 不把 `pi-client` / `pi-protocol` 的远程会话整套搬进来——那是"把 pi 会话搬远"，我们要的是"把工具搬远"，方向相反。
- 云端工作区终端已是 `script` PTY（Tab 补全可用）。打进 VM 的交互式登录 tty、以及要完整 xterm 的全屏 TUI 仍后置。
- 不为了 RPC 放弃 Desk 侧沙箱。Cursor 没有公开的 worker 沙箱，这是我们的优势不是负债。
