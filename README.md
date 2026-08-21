# neo-cloud-agent

对标 [Cursor Cloud Agent](https://cursor.com/docs/cloud-agent) 的云端 Agent 服务：LLM 推理在云端网关，任务在隔离 VM 里执行，Agent 内核使用 [pi-agent](https://github.com/earendil-works/pi)。

**设计见 [docs/architecture.md](docs/architecture.md)。**

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
  infra/                    compose 与三份 Dockerfile
  .neo/environment.json     本仓库自己的环境描述
```

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
pnpm dev                 # control-plane :8080 + llm-gateway :8081
# 打开 http://localhost:8080 对话
```

默认 `WORKER_RUNTIME=local`：`POST /v1/runs` 会在本机拉起 worker，嵌入 `createAgentSession`，推理走 gateway。设 `WORKER_RUNTIME=docker`（或 `SPAWN_LOCAL_WORKER=0`）则 `docker run` 一张 worker 镜像，工作区 bind-mount 进容器；容器里只有 run JWT，没有 Provider Key。`repoUrls` 会在 spawn 前落到 Run 工作区：本地目录直接拷贝，`github.com/org/repo` 或 HTTPS 地址则 `git clone --depth 1`。工作区里的 `.neo/environment.json`（或 `.cursor/environment.json`）若有 `install`，会在起 worker 前执行；`start` / `terminals` 在 worker 冷启动时跑，不进 install。第一次成功的 `install` 会打成 Environment Build 快照（`RUNS_DIR/.builds/<id>/workspace`）；之后相同 `repoUrls`+`ref` 的 Run 从快照或 warm slot 恢复，不再冷装。也可以 `POST /v1/environments` + `POST /v1/builds` 预热。`BUILD_CAPTURE=0` 关闭 JIT 打盘；`WARM_POOL_SIZE` 默认 1（`0` 关闭热池）。draft Build 不会成为新 Run 的 boot 镜像。对话页可以选环境和快照，或点「预热」先打盘。`environment.json` 的 `egress`（`allow_all` / `default_plus_allowlist` / `allowlist_only`）会拦远程 clone 和 worker `fetch`；Gateway 与 GitHub 仍放行。设了 `DATABASE_URL` 后 Environment / Build 也进 Postgres。工具输出和 session JSONL 备份会把运行时密钥打成 `[REDACTED]`。落地后控制面会建 `neo/<slug>-<id>` 分支（快照停在 base branch）。受控 commit 和草稿 PR 走控制面（`POST /v1/runs/:id/commit`、`POST /v1/runs/:id/pull-request`）；worker 只能申请短寿命 `neo.git.*` token。push / 开 GitHub PR 时控制面优先用 GitHub App 安装令牌（`GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_APP_INSTALLATION_ID`），没配 App 再回退 `SCM_PUSH_TOKEN` / `GITHUB_TOKEN`；私钥和 PAT 都不会进 VM。没有 GitHub 远程时会记一条 `local://pr/...`。Run 和事件落在 `.neo/runs/.control`，刷新页面或重启控制面不会丢掉对话列表。IDLE Run 在控制面重启后还能接着聊：follow-up 会从 session 备份恢复 JSONL 并重新拉起 worker（Docker 里 worker 启动时会下载备份，因为容器内 `SESSION_DIR` 不在工作区 bind-mount 上）。多个标签或设备打开同一条 Run，都订阅控制面同一条 SSE：先拉压缩 transcript，再跟直播 token。事件和 session 会再归档到对象存储（默认 `.neo/runs/.objects`，设 `OBJECT_STORE=s3` 可走 S3/R2/MinIO）。`start` 失败默认不挡住 Agent；要挡住就在 `.neo/environment.json` 写 `"startMustSucceed": true`。控制面重启后会认领还在跑的 worker；认领不到就等心跳，超时才标 ERROR。对外 API 可设 `CONTROL_PLANE_TOKEN`（或 `CONTROL_PLANE_AUTH=1` 自动生成），也可以用邮箱注册 / 登录；`ACCOUNTS_REQUIRED=1` 时对话页会要求登录，每个用户只能看到自己的 Run。worker 只用 run JWT 打 `/internal`。设了 `DATABASE_URL` / `REDIS_URL` 后，元数据进 Postgres，直播事件走 Redis；不设则继续用 `.control` JSON 和进程内总线。`WORKER_RUNTIME=firecracker` 需要 `/dev/kvm`、内核和烤进 worker 的 rootfs。`pnpm fc:assets` 拉 Firecracker 二进制和 CI vmlinux；`pnpm fc:rootfs` 把 `neo-cloud-agent-worker:dev` docker export 成 ext4（默认 overlay 打包器仍只打一张小盘，给单测用）。Guest 走 tap（地址落在 `172.16.0.0/12`），控制面会把 `127.0.0.1` 改写成 tap 宿主机 IP。嵌套 KVM 且 CPU 带 AMX 的宿主机上 `KVM_CREATE_VCPU` 会故障，live turn 会 skip；真机 / 非 AMX 宿主机再跑 `pnpm test:firecracker`。仓库根目录的 `.env` 会被两个控制面进程自动加载（已有环境变量优先）。没配 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 时 gateway 用 mock。

```bash
curl -s localhost:8080/health
curl -s -X POST localhost:8080/v1/runs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Add a README.md and run sh test.sh","repoUrls":["fixtures/toy-repo"]}'
# 然后看 SSE / transcript
curl -s localhost:8080/v1/runs/<id>/transcript
```

接 DeepSeek（推荐，OpenAI 兼容）：把 key 写进仓库根目录 `.env`（已 gitignore），不要提交。

```bash
# .env
LLM_UPSTREAM=deepseek
LLM_UPSTREAM_BASE_URL=https://api.deepseek.com/v1
LLM_UPSTREAM_MODEL=deepseek-chat
DEFAULT_MODEL=neo/deepseek
DEEPSEEK_API_KEY=sk-...
```

`neo/deepseek`、`neo/ds`、`ds` 会路由到 `deepseek-chat`；要推理模型把 `LLM_UPSTREAM_MODEL` 改成 `deepseek-reasoner`，或直接请求 `deepseek-reasoner`。

接 GitHub 远程（只放控制面，不要进 worker）：

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

# 用户账号（对话页可注册 / 登录；强制登录时打开）
# ACCOUNTS_REQUIRED=1

# Postgres / Redis（不设则用 .control JSON + 进程内事件总线）
# DATABASE_URL=postgres://neo:neo@127.0.0.1:5432/neo
# REDIS_URL=redis://127.0.0.1:6379

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
