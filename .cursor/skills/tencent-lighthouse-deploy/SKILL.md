---
name: tencent-lighthouse-deploy
description: Deploy and operate neo-cloud-agent on the Tencent Cloud Lighthouse host in Beijing. Use when shipping code to 62.234.211.200, restarting systemd units, fixing Caddy, saving API keys, checking VM slots, or when GitHub is unreachable from the server.
---

# 腾讯云轻量部署

生产机是腾讯云 **轻量应用服务器（Lighthouse）**，不是 CVM。按这份 skill 操作，不要凭印象重启、绑密钥或 `git pull`。

## 主机

| 项 | 值 |
| --- | --- |
| 控制台 | [北京六区实例列表](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8)（`rid=8`） |
| 实例 | `Halo建站-AFjg` / `lhins-b0l0d8b2` |
| 公网 | `62.234.211.200` |
| 规格 | 4C / 4G / 40G Ubuntu |
| 登录用户 | `ubuntu`（有免密 sudo） |
| 代码 | `/home/ubuntu/neo-cloud-agent` |
| 入口 | http://62.234.211.200/ （Caddy `:80` → `127.0.0.1:8080`） |
| Node | 已装 **v22.23.1**（满足 `>=22.19`） |
| Docker / KVM | **都没有**。`WORKER_RUNTIME=vm` 用 2 个 loop 挂载的 ext4 槽，不是 Firecracker |

SSH 别名（本机 `~/.ssh/config`）：

```
Host lighthouse
  HostName 62.234.211.200
  User ubuntu
  IdentityFile ~/.ssh/neo_lighthouse
  IdentitiesOnly yes
```

首次装公钥用控制台 **TAT**，不要在控制台「绑定密钥」（会重启）。详见 [reference.md](reference.md)。

## 硬约束

1. **不要重启实例。** 这台机以前跑过 Halo / Caddy，重启会中断线上。
2. **不要在控制台绑定新的 SSH 密钥。** 绑定会重启。用 TAT 往 `~/.ssh/authorized_keys` 追加。
3. **不要读、打印、提交** `/home/ubuntu/neo-cloud-agent/.env` 或 `.neo/llm-upstream.env`。只改键名，不回传值。
4. **不要把 Cloud Agent 的 GitHub token 拷到这台机。**
5. **不要重新拉起爱马仕。** 用户单元已改名为 `~/.config/systemd/user/hermes-gateway.service.disabled`。
6. 轻量访问 **GitHub 443 经常超时**（DNS 能解析到 `20.205.243.166`）。通了再用 `git pull`；不通就从能访问 GitHub 的机器 **tar/scp 覆盖源码**。

## 日常更新（已有 systemd）

在能访问 GitHub 的机器上先 push，再同步到轻量。

### A. GitHub 通

```bash
ssh lighthouse 'cd /home/ubuntu/neo-cloud-agent && git fetch origin <branch> && git checkout <branch> && git pull --ff-only origin <branch> && sudo systemctl restart neo-llm-gateway neo-control-plane'
```

先测：`ssh lighthouse 'curl -sS --connect-timeout 5 --max-time 8 -o /dev/null -w "%{http_code}\n" https://github.com/'`  
`000` / timeout 就走 B。

### B. GitHub 不通（常见）

不要在轻量上重试 `git pull` 干等。从 **已经 checkout 好的仓库** 打包，排除密钥和运行时数据：

```bash
tar -C /path/to/neo-cloud-agent \
  --exclude=node_modules --exclude=.git \
  --exclude=.neo/runs --exclude=.neo/vms \
  --exclude=.neo/llm-upstream.env --exclude=.env --exclude=dist \
  -czf - . \
| ssh lighthouse 'tar -C /home/ubuntu/neo-cloud-agent -xzf - && sudo systemctl restart neo-llm-gateway neo-control-plane'
```

`pnpm-lock.yaml` 变了再在轻量上 `cd /home/ubuntu/neo-cloud-agent && pnpm install`（这台机 Node 够新，不必 `PNPM_IGNORE_ENGINE`）。

### 重启后验收

```bash
ssh lighthouse '
  systemctl is-active neo-llm-gateway neo-control-plane
  curl -sS http://127.0.0.1:8080/health; echo
  curl -sS http://127.0.0.1:8081/health; echo
  curl -sS http://127.0.0.1:8080/ | grep -E "Neo Cloud Agent|API Key|vm-status" | head
'
```

期望：

- 两个 unit `active`
- control-plane：`ok: true`，`workerRuntime: "vm"`，`vmSlots.total: 2`，`llmConfigured` 看是否已存 Key
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

6. 安装 [units/](units/) 两个 systemd unit，`daemon-reload && enable --now`。
7. Caddy `:80` 反代 `127.0.0.1:8080`，`flush_interval -1`（SSE）。
8. 打开 http://62.234.211.200/ ，`admin` / `123456`（页面常会自动登录），在页上保存 API Key，**不要把 Key 发到聊天里**。

## 线上运行时

| 项 | 现状 |
| --- | --- |
| 进程 | `neo-llm-gateway` `:8081`，`neo-control-plane` `:8080`，Caddy `:80` |
| 工作目录 | `/home/ubuntu/neo-cloud-agent`（unit 的 `WorkingDirectory`） |
| 密钥 | 根目录 `.env` + `.neo/llm-upstream.env`（gitignore） |
| Worker | `WORKER_RUNTIME=vm`，2×4GiB ext4 在 `.neo/vms/`，无 KVM 则 loop 挂载 |
| 对话 | 默认管理员 `admin` / `123456`；`ACCOUNTS_REQUIRED` 未开 |
| 爱马仕 | 已下线，不要 `systemctl --user start hermes-gateway` |

改 `.env` 键值用脚本替换，不要 `cat` 整个文件。改完必须 `sudo systemctl restart neo-llm-gateway neo-control-plane`。只改 API Key 走页面即可，**不用重启**。

## 排障

| 现象 | 先查 |
| --- | --- |
| 打开 IP 是 Caddy 欢迎页 | `/etc/caddy/Caddyfile` 是否反代 `:8080`；`sudo systemctl reload caddy` |
| 页面显示已配置 Key，回复仍是 mock | 根目录是否有 `.neo/llm-upstream.env`；`curl -s localhost:8081/health` 的 `configured` |
| `git pull` SSL timeout | 走「日常更新 B」 |
| 新对话失败 / 槽满 | `curl -s localhost:8080/v1/vms`，同时最多 2 个任务 |
| unit 重启卡住 | `KillMode=control-group`；旧 worker 可能残留，`journalctl -u neo-control-plane -n 80` |
| 想上真 VM | 轻量没有 `/dev/kvm`，要换带嵌套虚拟化的 CVM，再 `pnpm fc:assets && pnpm fc:rootfs` |

看日志（不要把 Environment 打出来）：

```bash
ssh lighthouse 'journalctl -u neo-control-plane -u neo-llm-gateway -n 80 --no-pager'
```

## 给 Cloud Agent 的注意点

- SSH 目标就是 `lighthouse`。连不上先 TAT 追加当前公钥，不要重启。
- 同步代码默认用 tar，不要假设轻量能拉 GitHub。
- 验收只报 `ok` / `configured` / `workerRuntime` / 槽位数字，不报密钥。
- 改完代码照常 commit、push，再同步轻量并重启两个 unit。
