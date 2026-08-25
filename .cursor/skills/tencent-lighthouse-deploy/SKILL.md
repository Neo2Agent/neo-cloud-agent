---
name: tencent-lighthouse-deploy
description: Deploy and operate neo-cloud-agent on the Beijing Lighthouse app host 62.234.211.200 (Halo建站-AFjg). Use when shipping code, restarting systemd units, fixing Caddy, saving API keys, checking VM slots, SSHing as lighthouse, or wiring Cloud Agent Secrets (NEO_LIGHTHOUSE_SSH_KEY_B64 / TENCENTCLOUD_*). Domain bind is tencent-lighthouse-domain, not this skill. Not the MySQL/Redis host 101.42.105.230.
---

# 腾讯云轻量部署

生产机是腾讯云 **轻量应用服务器（Lighthouse）**，不是 CVM。按这份 skill 操作，不要凭印象重启、绑密钥或 `git pull`。

现网拆两台，**不要混**：

| | 本 skill（应用机） | 库机 |
| --- | --- | --- |
| 公网 | `62.234.211.200` | `101.42.105.230` |
| 实例 | `Halo建站-AFjg` | `neo-mysql-redis` |
| 职责 | 本仓库 + systemd + Caddy + VM 槽（Ubuntu 24.04 系统镜像） | Docker MySQL / Redis |

库机操作见 [../tencent-lighthouse-db/SKILL.md](../tencent-lighthouse-db/SKILL.md)。域名 `neorun.cloud` 解析见 [../tencent-lighthouse-domain/SKILL.md](../tencent-lighthouse-domain/SKILL.md) 和 [docs/production-domain.md](../../../docs/production-domain.md)。控制面要持久化时，在**本机**仓库根 `.env` 写 `DATABASE_URL` / `REDIS_URL` 指向库机，然后只重启 `neo-control-plane`。`/health` 应为 `metadataStore: "mysql"`、`eventBus: "redis"`。不要把库机密码打进聊天。

## 主机

| 项 | 值 |
| --- | --- |
| 控制台 | [北京六区实例列表](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8)（`rid=8`） |
| 实例 | `Halo建站-AFjg` / `lhins-b0l0d8b2` |
| 公网 | `62.234.211.200` |
| 规格 | 4C / 4G / 40G Ubuntu |
| 登录用户 | `ubuntu`（有免密 sudo） |
| 代码 | `/home/ubuntu/neo-cloud-agent` |
| 入口 | https://neorun.cloud/ 对话（Caddy → `:8080`）；https://neorun.cloud/admin/ 管理台（→ `:8090`）。IP 同样可用 `/` 与 `/admin/` |
| Node | 已装 **v22.23.1**（满足 `>=22.19`） |
| Docker / KVM | **都没有**。`WORKER_RUNTIME=vm` 用 2 个 loop 挂载的 ext4 槽，不是 Firecracker |
| 运行时栈 | **官方系统镜像** Ubuntu Server 24.04 LTS + Node 22 + pnpm + Caddy + systemd（`neo-llm-gateway` / `neo-control-plane`）。2026-08-22 已从爱马仕/Halo 应用镜像重装，不是应用模板 |

SSH 别名（本机 `~/.ssh/config`）：

```
Host lighthouse
  HostName 62.234.211.200
  User ubuntu
  IdentityFile ~/.ssh/neo_lighthouse
  IdentitiesOnly yes
```

首次装公钥用控制台 **TAT**，不要在控制台「绑定密钥」（会重启）。详见 [reference.md](reference.md)。

控制台实例名可能还叫 `Halo建站-AFjg`，那只是显示名。镜像已是 **Ubuntu Server 24.04 LTS 64bit 系统镜像**。不要再重装，除非用户明确要求。

## Cloud Agent 新对话（先做这个）

新开的 Cursor Cloud Agent **不会**带着上一轮的 `~/.ssh`。要操作这台轻量，先看环境 Secrets，再跑引导脚本。密钥只配在 Cursor 环境里，**不要写进仓库、不要打印、不要发到聊天**。

环境页：[6f60409c-9d84-11f1-a7d1-d6b4613131ce](https://cursor.com/dashboard/cloud-agents/environments/e/6f60409c-9d84-11f1-a7d1-d6b4613131ce) → Secrets。类型用 **Runtime Secret**。中途新加的 Secret **当前这轮读不到**，要再开一轮。

| Secret | 类型 | 是什么 |
| --- | --- | --- |
| `NEO_LIGHTHOUSE_SSH_KEY_B64` | Runtime Secret | 操作者自己电脑 `ssh-keygen` 出来的**私钥文件**做 `base64` 后的单行（`base64 -w0 ~/.ssh/neo_lighthouse`）。不是腾讯云控制台里的 ID，也不是 `.pub`，也不是带换行的 PEM 原文 |
| `TENCENTCLOUD_SECRET_ID` | Runtime Secret | 周栋账号下**子用户**的云 API SecretId（不要用主号） |
| `TENCENTCLOUD_SECRET_KEY` | Runtime Secret | 对应 SecretKey |
| `TENCENTCLOUD_REGION` | Environment Variable | `ap-beijing`（可以给模型看） |

公钥必须已经在轻量 `ubuntu` 的 `authorized_keys`。追加用 TAT 或已有 SSH，**不要**控制台「绑定密钥」。子用户 CAM 只开 `lighthouse` / `tat` / `dnspod`，不要给 `ResetInstance` / `RebootInstances` / 重装 / 销毁。

```bash
# 1) 有 Secret 就写 ~/.ssh/neo_lighthouse 和 Host lighthouse；没有就跳过
bash .cursor/skills/tencent-lighthouse-deploy/bootstrap-agent-access.sh

# 2) 只报是否 set，不要 echo 值
[ -n "${NEO_LIGHTHOUSE_SSH_KEY_B64:-}" ] && echo ssh_secret=set || echo ssh_secret=missing

# 3) SSH
ssh -o BatchMode=yes -o ConnectTimeout=10 lighthouse 'hostname; systemctl is-active neo-control-plane caddy'

# 4) 云 API（有 ID/KEY 时）
tccli lighthouse DescribeInstances --region ap-beijing --InstanceIds '["lhins-b0l0d8b2"]'
```

`ssh` 失败：公钥没在轻量上，或这轮没注入 `NEO_LIGHTHOUSE_SSH_KEY_B64`。不要重启实例。备案 / 微信扫码没有 API，仍要用户本人。库机 SSH 是另一把钥匙（`lighthouse-db`），不要拿这把去连 `101.42.105.230`。引导脚本仍兼容旧名 `NEO_LIGHTHOUSE_SSH_KEY`（PEM 原文），新对话只配 B64。

## 硬约束

1. **不要重启或再次重装实例。** 系统镜像已经是官方 Ubuntu 24.04。再重装会清盘。
2. **不要在控制台绑定新的 SSH 密钥。** 绑定会重启。用 TAT 往 `~/.ssh/authorized_keys` 追加。现网已写入 `neo-cloud-agent-deploy` 公钥。
3. **不要读、打印、提交** `/home/ubuntu/neo-cloud-agent/.env` 或 `.neo/llm-upstream.env`。只改键名，不回传值。
4. **不要把 Cloud Agent 的 GitHub token 拷到这台机。**
5. **不要再装爱马仕 / OpenClaw / clawhub / qwen-code，也不要选应用模板重装。**
6. 轻量访问 **GitHub 443 经常超时**（DNS 能解析到 `20.205.243.166`）。通了再用 `git pull`；不通就从能访问 GitHub 的机器跑 [deploy.sh](deploy.sh)（增量拷 + 本机构建）。不要在轻量上重试 `git pull` 干等。
7. **MySQL / Redis 不在这台机。** 不要在这里 `docker compose` 库，也不要重启 `101.42.105.230`。

## 日常更新（已有 systemd）

在能访问 GitHub 的机器上先 checkout / push，再**一条命令**发到轻量。不要手搓 tar，也不要在轻量上 `git pull` 干等（GitHub 443 经常超时，现网目录也没有 `.git`）。

```bash
bash .cursor/skills/tencent-lighthouse-deploy/bootstrap-agent-access.sh   # 新对话只需一次
bash .cursor/skills/tencent-lighthouse-deploy/deploy.sh                   # 或 pnpm deploy:lighthouse
```

[deploy.sh](deploy.sh) 会对比现网 `.deploy-revision`，只拷变更，按路径决定要不要 `pnpm install` / 构建对话页和管理台 / 重启哪个 unit，然后等到 `/health` ok。前端默认在**本机**构建再带上 `dist`。只改管理台静态资源时**不重启**控制面。

常用参数：`--dry-run` 只看计划；`--full` 全量覆盖（仍跳过 `.env` / `.neo` / `node_modules`）；`--remote-build` 改在轻量上 build；`--restart` 强制重启三个应用 unit。

手搓兜底（脚本坏了才用）：先测 `ssh lighthouse 'curl -sS --connect-timeout 5 --max-time 8 -o /dev/null -w "%{http_code}\n" https://github.com/'`。通了再 `git pull`；`000` / timeout 就 tar 覆盖，排除 `node_modules` `.git` `.neo` `.env` `dist`，然后按需 `pnpm install` / `pnpm build:web` / `pnpm build:admin`，只重启有改动的 unit。8090 只听本机，不要开防火墙。

### 重启后验收

```bash
ssh lighthouse '
  systemctl is-active neo-llm-gateway neo-control-plane neo-admin-api
  curl -sS http://127.0.0.1:8080/health; echo
  curl -sS http://127.0.0.1:8081/health; echo
  curl -sS http://127.0.0.1:8090/health; echo
  curl -sS http://127.0.0.1:8080/ | grep -E "Neo Cloud Agent|API Key|vm-status" | head
  curl -sS http://127.0.0.1:8090/ | grep -E "Neo 管理台|独立管理台" | head
'
```

期望：

- 三个 unit `active`（gateway / control-plane / admin-api）
- control-plane：`ok: true`，`workerRuntime: "vm"`，`vmSlots.total: 2`，`llmConfigured` 看是否已存 Key；接了库机后还应有 `metadataStore: "mysql"`、`eventBus: "redis"`
- gateway：若已存 DeepSeek Key，则 `upstream: "deepseek"` 且 `configured: true`
- `:80` 是对话页，不是 Caddy 欢迎页

`pnpm --filter ... start` 的 cwd 是 **package 目录**。API Key 必须写在**仓库根** `.neo/llm-upstream.env`，代码会往上找到 `pnpm-workspace.yaml`。不要把 Key 写进 `packages/control-plane/.neo/`。

## 首次部署

完整清单（TAT、防火墙、Caddy、unit）见 [reference.md](reference.md)。模板在 [units/](units/)。

最短路径：

1. TAT 写入 SSH 公钥，本机 `ssh lighthouse` 通。
2. 轻量防火墙放行 **22 / 80 / 443**（可选再放 8080、8081）。
3. 装 Node 22.19+、pnpm；确认 `mkfs.ext4`、`ip`、`sudo -n true`。
4. 把仓库放到 `/home/ubuntu/neo-cloud-agent`，`pnpm install`。
5. 从 `.env.example` 生成 `.env`（`chmod 600`）。4C/4G 用：

```
WORKER_RUNTIME=vm
VM_SLOT_COUNT=2
WORKER_CPUS=1
WORKER_MEMORY_MIB=512
WORKER_DISK_GIB=4
WARM_POOL_SIZE=0
LLM_UPSTREAM=mock
```

6. 安装 [units/](units/) 三个 systemd unit（gateway / control-plane / admin-api），`daemon-reload && enable --now`。
7. 现网 Caddy 用 domain skill 的 HTTPS 模板：`/` → `:8080`，`/admin/` → `:8090`，`flush_interval -1`（SSE）。
8. 打开 https://neorun.cloud/ 或 http://62.234.211.200/ ，手输 `admin` / `123456` 登录（页面不预填、不能跳过），在页上保存 API Key，**不要把 Key 发到聊天里**。管理台是 https://neorun.cloud/admin/ 。域名还没解析时先走 IP，绑域名与 HTTPS 见 domain skill。

## 线上运行时

| 项 | 现状 |
| --- | --- |
| 进程 | `neo-llm-gateway` `:8081`，`neo-control-plane` `:8080`，`neo-admin-api` `:8090`（本机），Caddy `:80` + `:443` |
| 工作目录 | `/home/ubuntu/neo-cloud-agent`（unit 的 `WorkingDirectory`） |
| 密钥 | 根目录 `.env` + `.neo/llm-upstream.env` + `.neo/scm-push.env`（gitignore） |
| Worker | `WORKER_RUNTIME=vm`，2×4GiB ext4 在 `.neo/vms/`，无 KVM 则 loop 挂载。`WORKER_MEMORY_MIB` 会限制 heap；unit 需 `Delegate=` 才有 cgroup RSS |
| 对话 | 必须手输 `admin` / `123456`；默认 `ACCOUNTS_REQUIRED=1` |
| 栈 | 官方 Ubuntu 24.04 系统镜像 + systemd + Caddy + Node 22 |

改 `.env` 键值用脚本替换，不要 `cat` 整个文件。改完必须 `sudo systemctl restart neo-llm-gateway neo-control-plane`。只改 API Key 走页面即可，**不用重启**。

## 排障

| 现象 | 先查 |
| --- | --- |
| 打开 IP 是 Caddy 欢迎页 | `/etc/caddy/Caddyfile` 是否反代 `:8080`；`sudo systemctl reload caddy` |
| 页面显示已配置 Key，回复仍是 mock | 根目录是否有 `.neo/llm-upstream.env`；`curl -s localhost:8081/health` 的 `configured` |
| `git pull` SSL timeout | 走「日常更新 B」 |
| 新对话失败 / 槽满 | `curl -s localhost:8080/v1/vms`，同时最多 2 个任务 |
| unit 重启卡住 | `KillMode=process`：重启控制面不会杀掉已 spawn 的 worker，下次启动 `adopt()` 收回。若 unit 停不住，看 `journalctl -u neo-control-plane -n 80` |
| 想上真 VM | 轻量没有 `/dev/kvm`，要换带嵌套虚拟化的 CVM，再 `pnpm fc:assets && pnpm fc:rootfs` |

看日志（不要把 Environment 打出来）：

```bash
ssh lighthouse 'journalctl -u neo-control-plane -u neo-llm-gateway -u neo-admin-api -n 80 --no-pager'
```

## 给 Cloud Agent 的注意点

- 新对话先跑 [bootstrap-agent-access.sh](bootstrap-agent-access.sh)。它读 `NEO_LIGHTHOUSE_SSH_KEY_B64`（私钥文件的单行 base64），写成 `~/.ssh/neo_lighthouse`。SSH 目标就是 `lighthouse`。
- 连不上先看 Secret 是否注入；公钥不在就 TAT 追加，不要重启、不要绑密钥。
- 同步代码用 [deploy.sh](deploy.sh)，不要假设轻量能拉 GitHub，也不要手搓全量 tar。
- 验收只报 `ok` / `configured` / `workerRuntime` / 槽位数字，不报密钥。
- 改完代码照常 commit、push，再 `bash .cursor/skills/tencent-lighthouse-deploy/deploy.sh`。脚本自己决定重启哪个 unit。
- 官方 `tccli` / SDK 只管云资源（实例、防火墙、TAT、DNS）。发版仍是 SSH + systemd，见上文「日常更新」。
