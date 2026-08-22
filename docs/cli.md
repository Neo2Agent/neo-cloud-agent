# Neo CLI

`packages/cli` 是控制面 `/v1` 的终端宿主，二进制名 `neo`。它和对话页、未来的 Slack / GitHub ingress 同级：**只发任务、订事件、做交付动作**。不在本机跑 pi，不持有 Provider Key，不 spawn worker。

对标对象是 Cursor 的 **Cloud Agents 客户端**（`POST https://api.cursor.com/v1/agents` + SSE）以及它的 headless 打印协议（`agent -p --output-format`），不是本地 `agent` TUI。本地 `agent` 在用户磁盘上执行工具；neo 的工具在隔离 VM 里。把 loop 搬进 CLI 会违反 [architecture.md §2](./architecture.md)。

---

## 1. 为什么是客户端，不是本机 Agent

Cursor 后来把 Agent 拆成多个宿主：IDE、本地 CLI、`-p`、ACP、SDK、Cloud VM、`agent worker`。推理始终托管；「local」只表示文件和 shell 在哪。

neo 的拆法和 Cloud Agent 对齐，不和本地 CLI 对齐：

| 层 | 在哪 | CLI 做不做 |
| --- | --- | --- |
| 编排 / 状态机 / Build / SCM | control-plane | 否，HTTP 调用 |
| 推理与密钥 | llm-gateway | 否，VM 用 run JWT 打网关 |
| Agent loop + read/write/bash | worker（VM / local / docker） | 否 |
| 鉴权、创建 Run、SSE、跟进、归档、diff、PR | `/v1` | **是** |

三条故意不做的产品：

1. **本机 pi CLI**（对标 `agent -p` 改 cwd）。云端 worker 读的是工作区 `AGENTS.md` / skills / hooks，不是开发者家里的 `~/.pi`。本机再嵌一份 pi 是另一个产品，语义不能和 `neo run` 混用。
2. **Worker 桥**（对标 `agent worker start`）。loop 在云、工具打开发者机器。要长期通道和另一套信任模型，不是把现有能力 CLI 化。
3. **ACP / 本机 sandbox / `--yolo`。** 那些是「工具打在用户机器上」才需要的审批面。neo 的边界是 VM + JWT + egress + 受控 git。

---

## 2. 和 Cursor CLI 的对照

| Cursor | Neo | 说明 |
| --- | --- | --- |
| `agent login` / `CURSOR_API_KEY` | `neo login` / `NEO_API_KEY` | 浏览器登录以后再做；P0 用账号或服务令牌 |
| `agent "…"` 交互 TUI | 未做 | P0 只有 headless；stdin 跟进以后再加 |
| `agent -p` + `text\|json\|stream-json` | `neo run -p --output-format` | 默认就是等待一轮结束（没有 TUI 可进） |
| `--resume` / `--continue` / `agent ls` | `neo resume` / `neo follow` / `neo ls` | 复用 run id，不另起 loop |
| `--model` / `--workspace` | `--model` / `--repo` / `--dir` / `--env` | cwd 对远端控制面不可见，必须显式给仓库 |
| `--force` / `--trust` / sandbox | 不做 | 隔离已经在执行面 |
| `&` 移交 Cloud | 不需要 | 没有本机会话可移交 |
| `agent worker` / `agent acp` | 不做 | 后期产品，单开设计 |

抄 Cursor 的是：**同一 loop、多个宿主；headless 是一等公民；JSON 事件可脚本化。** 不抄在终端里本地改文件的那个 `agent`。

---

## 3. 命令面（P0）

```
neo [--url] [--api-key] [--output-format text|json|stream-json] <command>

neo login [--email] [--password] [--token]
neo logout
neo whoami
neo health

neo run [prompt…] [-p|--print] [--detach|--no-wait]
        [--repo url]… [--dir path]… [--env id] [--build id]
        [--model] [--ref] [--reuse-build|--no-reuse-build]
        [--timeout 10m]

neo follow <runId> [text…] [--delivery prompt|steer|follow_up]
neo resume <runId>
neo ls
neo get <runId>
neo log <runId> [--follow]
neo abort <runId>
neo archive <runId>
neo diff <runId>
neo diag <runId>
neo pr <runId> [--title] [--body]
neo commit <runId> -m <message>
neo env ls
neo build ls
neo vms
```

没有子命令时，剩余参数当作 `run` 的 prompt，和 Cursor 的 `agent "fix the tests"` 一样：

```
neo --repo fixtures/toy-repo -p "只回复一个词：pong"
```

`run` / `follow` / `resume` 默认等到本轮 `IDLE` / `ERROR` / `ARCHIVED` / `EXPIRED`。`--detach`（`--no-wait`）创建或投递后立刻打印 run id。

`-p` / `--print` 是 Cursor 兼容开关，P0 与默认等待相同。stdout 不是 TTY、或 stdin 被管道进来时，也按 print 处理（prompt 可从 stdin 读）。

### 3.1 以后才做

- 交互 TUI、slash、方向键选 Run
- `neo login` 打开浏览器
- 本机 pi 模式、worker 桥、ACP
- `env create` / `build create` / 写 LLM Key（Key 仍走页面或服务器文件，避免打进 argv）
- 稳定 SDK 包（CLI 先直接打 `/v1`；合约继续留在 `packages/contracts`）

---

## 4. 鉴权与配置

解析顺序（后者覆盖前者）：

1. `~/.config/neo/config.json`（`url`）
2. `~/.config/neo/credentials.json`（`token`，`0600`）
3. 环境变量：`NEO_API_URL`，`NEO_API_KEY` / `NEO_API_TOKEN` / `NEO_TOKEN` / `CONTROL_PLANE_TOKEN`
4. 旗标：`--url`，`--api-key`

`NEO_CONFIG_DIR` 或 `XDG_CONFIG_HOME/neo` 可改目录。默认 URL 是 `http://127.0.0.1:8080`。

| 方式 | 行为 |
| --- | --- |
| `neo login --token` | 写入 credentials，可先 `POST /v1/auth` 校验 |
| `neo login --email --password` | `POST /v1/auth/login`，存 `neo_sess_*` |
| `neo login`（TTY） | 提示邮箱和密码 |
| 控制面未开鉴权 | 无 token 也可以打 `/v1` |
| `neo logout` | 删 credentials；若是 session 则 `POST /v1/auth/logout` |

对话页不再自动登录，也不支持注册；`neo login --email admin --password 123456` 走 `POST /v1/auth/login`。

不要把 Provider Key 交给 CLI。`GET /v1/settings/llm` 只用来看 `configured`；写入仍走已有 settings API 或服务器上的 `.neo/llm-upstream.env`。

---

## 5. 仓库参数

`POST /v1/runs` 仍然要求 `repoUrls`。控制面按自己的根目录解析相对路径、拷本地目录、或 `git clone` 远程地址。开发者笔记本上的 cwd，轻量机上的控制面看不见。

| 旗标 | 送到 API 的值 |
| --- | --- |
| `--repo fixtures/toy-repo` | 原样。只有控制面能看到这条相对路径时才有用 |
| `--repo github.com/acme/app` | 远程 clone |
| `--dir ./my-app` | **绝对路径**。仅控制面与 CLI 同机时有用 |
| `--env <id>` | 若没有 `--repo` / `--dir`，用 Environment 的 `config.repos` |

缺少仓库时直接失败，不要默默把 cwd 当成工作区——远端会得到一条无效路径。

所有 `run` 都带 `source: "cli"`。

---

## 6. 打印协议 `neo.cli.v1`

只保证这些字段。`RunEvent.data` 里的工具参数按附加信息，不当作稳定 API（和 Cursor 对 tool envelope 的态度相同）。

### `text`（默认）

stdout：生命周期一行、工具一行、助手 token 原样刷出。  
stderr：诊断、重连、用法错误。

### `json`

成功时 stdout **一行**对象，失败时非 0 退出、错误在 stderr、**不写 JSON**。

```json
{
  "type": "result",
  "subtype": "success",
  "protocol": "neo.cli.v1",
  "is_error": false,
  "duration_ms": 1234,
  "result": "助手全文",
  "run_id": "…",
  "status": "IDLE",
  "event_count": 12
}
```

`subtype`：`success` | `error` | `timeout` | `aborted` | `detached`。

### `stream-json`

NDJSON，忽略不认识的 `type`：

```json
{"type":"system","subtype":"init","protocol":"neo.cli.v1","run_id":"…","model":"neo/deepseek"}
{"type":"event","kind":"run.provisioning","title":"Provisioning worker","id":"…","created_at":"…"}
{"type":"assistant","text":"Hel","delta":true}
{"type":"tool","phase":"start","name":"bash","title":"Tool bash"}
{"type":"result","subtype":"success","protocol":"neo.cli.v1","is_error":false,"run_id":"…","status":"IDLE"}
```

`message.delta` 的 `data.delta` 映成 `assistant`；`tool.*` 映成 `tool`；其余 `RunEvent` 映成 `event`。

### 退出码

| 码 | 含义 |
| --- | --- |
| 0 | `IDLE`，或 `--detach` 成功投递 |
| 1 | Run `ERROR` / 业务失败 |
| 2 | 用法、鉴权、缺少仓库 |
| 3 | `--timeout` |
| 4 | 网络 / 控制面不可达 |

等到 `run.idle` / `run.error` / `run.archived`，或 `GET /v1/runs/:id` 变成 `IDLE|ERROR|ARCHIVED|EXPIRED`。SSE 断开就带 `Last-Event-ID` / `after` 重连，并短轮询 Run 状态兜底。多端订阅语义与对话页相同：worker 只生产一次，CLI 订控制面的流。

---

## 7. 和现有面的关系

```
neo / web / curl
        │  /v1  + SSE
        ▼
 control-plane          llm-gateway
        │                    ▲
        │ spawn              │ run JWT
        ▼                    │
     worker + pi  ───────────┘
```

- 对话页继续做选环境、存 Key、看 VM 槽。
- `scripts/e2e-http.ts` 可以逐步改成调 CLI；P0 不删它。
- 槽位是硬资源。交互占着不 `archive` 会占 VM。`--detach` 给脚本；人工等待结束后提示 run 仍占槽，直到归档或过期。

---

## 8. 实现边界

| 可以 | 不可以 |
| --- | --- |
| 新 package `@neo-cloud-agent/cli`，只依赖 `contracts` | 依赖 `worker` / `llm-gateway` / pi |
| 用 Node 22 `fetch` + SSE | 为 CLI 加 commander / ink / 重型 TUI |
| 把 `RunEvent` 映成 `neo.cli.v1` | 在 CLI 里执行 read/edit/bash |
| 文档写清云端只加载**工作区** skills / `AGENTS.md`，不读宿主机 `~/.pi` | 假装 `neo` 和本机 `agent` TUI 行为完全一致 |

进程模型不变：仍然是 control-plane + llm-gateway + worker 镜像。CLI 不是第四个 Deployment。
