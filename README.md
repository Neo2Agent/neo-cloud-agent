# neo-cloud-agent

对标 [Cursor Cloud Agent](https://cursor.com/docs/cloud-agent) 的云端 Agent 服务：LLM 推理在云端网关，任务在隔离 VM 里执行，Agent 内核使用 [pi-agent](https://github.com/earendil-works/pi)。

**现状总览见 [docs/architecture-overview.md](docs/architecture-overview.md)。** 完整架构图见 [docs/diagrams/architecture-complete.png](docs/diagrams/architecture-complete.png)。设计蓝图与原则见 [docs/architecture.md](docs/architecture.md)。后管与 New API 怎么拆见 [docs/admin-platform-research.md](docs/admin-platform-research.md)。现网两台轻量不要混：应用机（北京 `62.234.211.200`，部署本仓库）见 [.cursor/skills/tencent-lighthouse-deploy/SKILL.md](.cursor/skills/tencent-lighthouse-deploy/SKILL.md)；库机（`101.42.105.230`，Docker MySQL / Redis）见 [.cursor/skills/tencent-lighthouse-db/SKILL.md](.cursor/skills/tencent-lighthouse-db/SKILL.md)。域名 `neorun.cloud` 的解析与 HTTPS 见 [docs/production-domain.md](docs/production-domain.md) 和 [.cursor/skills/tencent-lighthouse-domain/SKILL.md](.cursor/skills/tencent-lighthouse-domain/SKILL.md)。

## 怎么拆

**一个 monorepo，两个控制面进程，一张 worker 镜像。** 不要按模块开仓库。

```
neo-cloud-agent/
  packages/contracts        共享协议（库，不是服务）
  packages/control-plane    进程 1：api + 编排 + 环境 + SCM + 事件
  packages/llm-gateway      进程 2：唯一持有模型密钥
  packages/worker           打进 VM / 任务容器，不是集群 Deployment
  packages/extensions       打进同一张 worker 镜像
  packages/web              对话页，由 control-plane 托管
  packages/admin-api        管理台后端（独立进程，默认 :8090）
  packages/admin-web        管理台前端（独立 Vite，默认 :5176）
  packages/desk             Electron 桌面壳 + 本机 worker（可选）
  packages/cli              终端客户端 `neo`（打 /v1，不跑 Agent loop）
  packages/mobile           手机客户端（`pnpm dev:mobile` :5175；Expo 入口 App.tsx）
  infra/                    compose 与三份 Dockerfile
  .neo/environment.json     本仓库自己的环境描述
```

## 现在 main 上有什么

设计蓝图仍是 [docs/architecture.md](docs/architecture.md)。已经落地、文档必须对得上的产品面：

| 面 | 行为 |
| --- | --- |
| 对话页 | React。工具调研和模型答复按时间拆行（工具在最终答复上面）。Markdown、Diff、文件树、粘贴图片、token 用量、归档 |
| 管理台 | 独立应用：本地 `pnpm dev:admin`（API `:8090` + UI `:5176`）。现网 `https://neorun.cloud/admin/`，对话页仍是 `https://neorun.cloud/`。不和对话页共用。仅平台管理员 |
| 模型 | 默认 DeepSeek **v4-flash**；设置里可切 Pro。退役的 `deepseek-chat` / `deepseek-reasoner` 会改写成 flash |
| 轻量机 | `WORKER_RUNTIME=vm`：无 KVM 则 2 个 loop ext4 槽。空闲 15 分钟写回工作区再卸槽（`WORKER_IDLE_RELEASE_MS`，`0` 关闭）。槽满新对话排队，不报错 |
| CLI | `pnpm neo`，见 [docs/cli.md](docs/cli.md) |
| 云工具 | `neo_git_commit` / `neo_pr_open` / `neo_diag` / `neo_browse` / `neo_mcp_*` / `neo_artifact_upload` |
| 桌面端 | Electron 壳 + 本机/云端目标。设计与落地见 [docs/desk.md](docs/desk.md) |
| 手机端 | P0：`pnpm dev:mobile`（:5175）。登录、列表、开 Run、SSE、跟进；`source` 为 ios/android。推送走 `/v1/devices`。方案见 [docs/mobile.md](docs/mobile.md) |

```mermaid
flowchart LR
  User --> API
  API --> Orch[control-plane]
  Orch --> VM
  VM --> Pi[worker + pi-coding-agent]
  Pi --> GW[llm-gateway]
  GW --> Provider
```

## 本地

需要 **Node 22.19+**（pi-coding-agent 的 engines）。用 pnpm：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev                 # 只起后端：control-plane :8080 + llm-gateway :8081
pnpm dev:web             # Web UI :5173（后端已在则复用 :8080）
pnpm dev:admin           # 独立管理台：admin-api :8090 + admin-web :5176（现网是 /admin/）
pnpm dev:desk            # Desk UI :5174 + Electron 窗口（另一套 UI，共用后端）
pnpm dev:mobile          # 手机客户端 :5175（共用 :8080）
pnpm deploy:lighthouse   # 把当前 checkout 发到腾讯云轻量应用机
```

默认 `WORKER_RUNTIME=local`：`POST /v1/runs` 会在本机拉起 worker，嵌入 `createAgentSession`，推理走 gateway。设 `WORKER_RUNTIME=docker`（或 `SPAWN_LOCAL_WORKER=0`）则 `docker run` 一张 worker 镜像，工作区 bind-mount 进容器；容器里只有 run JWT，没有 Provider Key。`repoUrls` 会在 spawn 前落到 Run 工作区：本地目录直接拷贝，`github.com/org/repo` 或 HTTPS 地址则 `git clone --depth 1`。工作区里的 `.neo/environment.json`（或 `.cursor/environment.json`）若有 `install`，会在起 worker 前执行；`start` / `terminals` 在 worker 冷启动时跑，不进 install。第一次成功的 `install` 会打成 Environment Build 快照（`RUNS_DIR/.builds/<id>/workspace`）；之后相同 `repoUrls`+`ref` 的 Run 从快照或 warm slot 恢复，不再冷装。恢复和预热优先 `cp --reflink=always`，文件系统不支持再整树复制；Firecracker 生产 rootfs 不支持 CoW 时只读共享原盘，不整份拷 1.5GiB。也可以 `POST /v1/environments` + `POST /v1/builds` 预热。`BUILD_CAPTURE=0` 关闭 JIT 打盘；`WARM_POOL_SIZE` 默认 1（`0` 关闭热池）。draft Build 不会成为新 Run 的 boot 镜像。对话页可以选环境和快照，或点「预热」先打盘。`environment.json` 的 `egress`（`allow_all` / `default_plus_allowlist` / `allowlist_only`）会拦远程 clone 和 worker `fetch`；Gateway 与 GitHub 仍放行。设了 `DATABASE_URL` 后 Environment / Build 也进 Postgres。工具输出和 session JSONL 备份会把运行时密钥打成 `[REDACTED]`。落地后控制面会建 `neo/<slug>-<id>` 分支（快照停在 base branch）。受控 commit 和草稿 PR 走控制面（`POST /v1/runs/:id/commit`、`POST /v1/runs/:id/pull-request`）；worker 只能申请短寿命 `neo.git.*` token。Agent 在 VM 里用 `neo_git_commit` / `neo_pr_open` / `neo_diag`，不要自己 `git push`。`GET /v1/runs/:id/diagnostics` 看 setup 日志、egress 拒绝和环境版本。push / 开 GitHub PR 时控制面优先用 GitHub App 安装令牌（`GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_APP_INSTALLATION_ID`），没配 App 再回退 `SCM_PUSH_TOKEN` / `GITHUB_TOKEN`；私钥和 PAT 都不会进 VM。没有 GitHub 远程时会记一条 `local://pr/...`。Run 和事件落在 `.neo/runs/.control`，刷新页面或重启控制面不会丢掉对话列表。IDLE Run 在控制面重启后还能接着聊：follow-up 会从 session 备份恢复 JSONL 并重新拉起 worker（Docker 里 worker 启动时会下载备份，因为容器内 `SESSION_DIR` 不在工作区 bind-mount 上）。多个标签或设备打开同一条 Run，都订阅控制面同一条 SSE：先拉压缩 transcript，再跟直播 token。事件和 session 会再归档到对象存储（默认 `.neo/runs/.objects`，设 `OBJECT_STORE=s3` 可走 S3/R2/MinIO）。`start` 失败默认不挡住 Agent；要挡住就在 `.neo/environment.json` 写 `"startMustSucceed": true`。控制面重启后会认领还在跑的 worker；认领不到就等心跳，超时才标 ERROR。对外 API 可设 `CONTROL_PLANE_TOKEN`（或 `CONTROL_PLANE_AUTH=1` 自动生成），也可以用账号或邮箱登录（左下角）；默认管理员是 `admin` / `123456`。设了 `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` 后还会再创建一个账号。对话页必须手输账号和密码，不会预填，也不能跳过。默认必须登录（`ACCOUNTS_REQUIRED=0` 才允许匿名），每个用户只能看到自己的 Run。worker 只用 run JWT 打 `/internal`。设了 `DATABASE_URL` / `REDIS_URL` 后，元数据进 Postgres，直播事件走 Redis；不设则继续用 `.control` JSON 和进程内总线。`WORKER_RUNTIME=firecracker` 需要 `/dev/kvm`、内核和烤进 worker 的 rootfs。`pnpm fc:assets` 拉 Firecracker 二进制和 CI vmlinux；`pnpm fc:rootfs` 把 `neo-cloud-agent-worker:dev` docker export 成 ext4（默认 overlay 打包器仍只打一张小盘，给单测用）。Guest 走 tap（地址落在 `172.16.0.0/12`），控制面会把 `127.0.0.1` 改写成 tap 宿主机 IP。嵌套 KVM 且 CPU 带 AMX 的宿主机上 `KVM_CREATE_VCPU` 会故障，live turn 会 skip；真机 / 非 AMX 宿主机再跑 `pnpm test:firecracker`。仓库根目录的 `.env` 会被两个控制面进程自动加载（已有环境变量优先）。没配 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 时 gateway 用 mock。

```bash
curl -s localhost:8080/health
curl -s -X POST localhost:8080/v1/runs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Add a README.md and run sh test.sh","repoUrls":["fixtures/toy-repo"]}'
# 然后看 SSE / transcript
curl -s localhost:8080/v1/runs/<id>/transcript
```

终端客户端（设计见 [docs/cli.md](docs/cli.md)）走同一套 `/v1`，不在本机跑 pi：

```bash
pnpm neo --repo fixtures/toy-repo -p "只回复一个词：pong。不要调用工具。"
pnpm neo login --email admin --password 123456
pnpm neo ls
pnpm neo log <runId>
```

`NEO_API_URL` 默认 `http://127.0.0.1:8080`。CI 用 `NEO_API_KEY` 或 `--api-key`。`--output-format json|stream-json` 给脚本；`--detach` 只创建不阻塞。


接 DeepSeek（推荐，OpenAI 兼容）：把 key 写进仓库根目录 `.env`（已 gitignore），不要提交。

```bash
# .env
LLM_UPSTREAM=deepseek
LLM_UPSTREAM_BASE_URL=https://api.deepseek.com/v1
LLM_UPSTREAM_MODEL=deepseek-v4-flash
DEFAULT_MODEL=neo/deepseek
DEEPSEEK_API_KEY=sk-...
```

`neo/deepseek`、`neo/ds`、`ds` 以及已停用的 `deepseek-chat` / `deepseek-reasoner` 都会路由到便宜的 `deepseek-v4-flash`。要更强的模型把设置里的型号改成 `deepseek-v4-pro`，或直接请求 `deepseek-v4-pro`。

4C/4G 轻量机（现网）用 loop 槽，不要开 Docker / Firecracker。`WORKER_MEMORY_MIB` 会打进 loop/local worker 的 V8 堆上限；control-plane unit 开了 cgroup `Delegate=` 时再套 RSS。归档后控制面丢掉内存里的事件，对话从 MySQL / `.control` 再读。对象存储默认仍是本机 `RUNS_DIR/.objects`，不要为了现网去切 S3。

```bash
WORKER_RUNTIME=vm
VM_SLOT_COUNT=2
WORKER_MEMORY_MIB=512
WORKER_DISK_GIB=4
WORKER_IDLE_RELEASE_MS=900000   # 空闲 15 分钟卸槽；0 = 不自动释放
```

卸槽前必须把 slot 工作区拷回 `RUNS_DIR`，否则下一轮 claim 会擦盘。两个槽都忙时 `POST /v1/runs` 返回 `NOT_YET_STARTED` 并发 `run.queued`。

接 GitHub 远程（只放控制面，不要进 worker）。也可以在对话页设置里贴 PAT，写到 `.neo/scm-push.env`：

```bash
# 推荐：GitHub App 安装令牌
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=987654
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"

# 没配 App 时的回退
# SCM_PUSH_TOKEN=ghp_...
# GITHUB_TOKEN=ghp_...

# 对象存储（默认写在 RUNS_DIR/.objects）
# OBJECT_STORE=s3
# S3_BUCKET=neo-transcripts
# S3_REGION=us-east-1
# S3_ENDPOINT=https://s3.amazonaws.com
# S3_ACCESS_KEY_ID=...
# S3_SECRET_ACCESS_KEY=...

# 对外 API 令牌（不设则本机不鉴权，方便测试）
# CONTROL_PLANE_TOKEN=neo_...
# CONTROL_PLANE_AUTH=1

# 用户账号（默认必须手输 admin / 123456；ACCOUNTS_REQUIRED=0 才允许匿名）
# ACCOUNTS_REQUIRED=1
# DEFAULT_ADMIN=1
# DEFAULT_ADMIN_PASSWORD=123456
# BOOTSTRAP_EMAIL=you@example.com
# BOOTSTRAP_PASSWORD=at-least-8-chars
# ADMIN_EMAILS=ops@example.com
# NEW_API_CONSOLE_URL=http://127.0.0.1:3000

# MySQL 或 Postgres / Redis（不设则用 .control JSON + 进程内事件总线）
# DATABASE_URL=mysql://app:app@127.0.0.1:3306/app
# DATABASE_URL=postgres://neo:neo@127.0.0.1:5432/neo
# REDIS_URL=redis://:pass@127.0.0.1:6379

# 接口限流（控制面 + LLM Gateway）。单测默认关；现网默认开。0 = 该档不限。
# RATE_LIMIT=1
# RATE_LIMIT_TRUST_PROXY=1
# RATE_LIMIT_IP=240
# RATE_LIMIT_LOGIN=20
# RATE_LIMIT_CREATE_RUN=12
# RATE_LIMIT_SSE=6
# RATE_LIMIT_LLM_RUN=90

# Firecracker（需要 /dev/kvm、内核和 rootfs）
# WORKER_RUNTIME=firecracker
# FIRECRACKER_BIN=infra/firecracker/.assets/firecracker
# FIRECRACKER_KERNEL=infra/firecracker/.assets/vmlinux
# FIRECRACKER_ROOTFS=infra/firecracker/.assets/rootfs.ext4
```

也可以接其它 OpenAI 兼容上游：

```bash
export OPENAI_API_KEY=sk-...
export LLM_UPSTREAM=openai
export LLM_UPSTREAM_MODEL=gpt-4o-mini
pnpm dev
```

自动化测试：

```bash
pnpm test                 # 单测 + 进程内 mock e2e（clone + worker + IDLE）
pnpm test:e2e             # 打已经在跑的 :8080（mock 即可）
E2E_EXPECT_README=1 pnpm test:e2e:live   # 真模型：加 README 并跑 test.sh
pnpm build:worker-image && pnpm test:docker   # 容器里跑同一条 mock turn
pnpm fc:assets && pnpm fc:rootfs && pnpm test:firecracker   # 真机 KVM + 生产 rootfs 跑同一条 turn；没资产则 skip
```

Docker worker（控制面仍在宿主机时）：

```bash
docker compose -f infra/docker-compose.yml --profile worker build worker
export WORKER_RUNTIME=docker
export WORKER_IMAGE=neo-cloud-agent-worker:dev
# Linux 上 worker 通过 host.docker.internal 回连 :8080 / :8081
pnpm dev
```

Worker 也可以不由 control-plane 拉起，手动挂到一个 Run：

```bash
RUN_ID=<id> pnpm dev:worker
```

## 不要做的五件事

1. 不要 fork pi 加云功能——用 worker + extensions。
2. 不要把 Provider Key 写进 VM。
3. 不要在 `install` 里起长驻服务。
4. 不要让 bash 拿着长期 git token 去 push。
5. 不要为了「推理在云端」把 Agent loop 放到控制面。
