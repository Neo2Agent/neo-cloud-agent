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

## 仓库与服务

**一个 monorepo，两个控制面进程，一张 worker 镜像。** 不要按模块开仓库。细节见 [docs/architecture.md §14](docs/architecture.md#14-服务进程仓库三件不同的事)。

| 部署物 | 形态 | 状态 |
| --- | --- | --- |
| `packages/contracts` | 库，不是服务 | 已有类型 |
| `packages/control-plane` | 1 个进程（api + 编排 + SCM + 事件） | 未实现 |
| `packages/llm-gateway` | 1 个进程（唯一持有模型密钥） | 未实现 |
| `packages/worker` | VM / 任务容器镜像，不是集群服务 | 未实现 |

P0 不要再拆 `env-service`、`scm-service`、`orchestrator` 成独立 Deployment 或独立 Git 仓库。 |

## 不要做的五件事

1. 不要 fork pi 加云功能——用 worker + extensions。
2. 不要把 Provider Key 写进 VM。
3. 不要在 `install` 里起长驻服务。
4. 不要让 bash 拿着长期 git token 去 push。
5. 不要为了「推理在云端」把 Agent loop 放到控制面。
