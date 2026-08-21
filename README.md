# neo-cloud-agent

对标 [Cursor Cloud Agent](https://cursor.com/docs/cloud-agent) 的云端 Agent 服务：LLM 推理在云端网关，任务在隔离 VM 里执行，Agent 内核使用 [pi-agent](https://github.com/earendil-works/pi)。

**完整设计见 [docs/architecture.md](docs/architecture.md)。** 跨进程类型在 [`packages/contracts`](packages/contracts)。

## 一句话结构

控制面编排 Run / 环境 / Build / SCM；VM 内的 `neo-worker` 嵌入 `createAgentSession()`；`pi-ai` 的 `baseUrl` 指向 LLM Gateway（VM 只持有短寿命 JWT，不持有 Provider Key）。

```mermaid
flowchart LR
  User --> API
  API --> Orch[Orchestrator]
  Orch --> VM
  VM --> Pi[pi-coding-agent]
  Pi --> GW[LLM Gateway]
  GW --> Provider
```

## 仓库

| 路径 | 状态 |
| --- | --- |
| `docs/architecture.md` | 架构蓝图 |
| `packages/contracts` | Run / Event / Env / Worker / LLM 合约 |
| `packages/api` | 未实现（P0） |
| `packages/llm-gateway` | 未实现（P0） |
| `packages/worker` | 未实现（P0） |

## 不要做的五件事

1. 不要 fork pi 加云功能——用 worker + extensions。
2. 不要把 Provider Key 写进 VM。
3. 不要在 `install` 里起长驻服务。
4. 不要让 bash 拿着长期 git token 去 push。
5. 不要为了「推理在云端」把 Agent loop 放到控制面。
