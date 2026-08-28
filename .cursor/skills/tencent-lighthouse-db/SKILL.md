---
name: tencent-lighthouse-db
description: Operate Docker MySQL 8.4 and Redis 7 on the new Beijing Lighthouse (101.42.105.230 / neo-mysql-redis). Use when checking or restarting db-mysql/db-redis, reading persisted runs/events, wiring DATABASE_URL or REDIS_URL, or opening 3306/6379. Not the app host 62.234.211.200.
---

# 腾讯云轻量：MySQL / Redis 库机

这是 **新账号上的第二台轻量**，只跑 Docker 里的 MySQL + Redis。  
**不要**把它当成应用机，也 **不要**去 `62.234.211.200` 上找这两个容器。

应用机（部署 neo-cloud-agent、systemd、Caddy、VM 槽）见 [../tencent-lighthouse-deploy/SKILL.md](../tencent-lighthouse-deploy/SKILL.md)。

## 两台机

| | 应用机 | 库机（本 skill） |
| --- | --- | --- |
| 账号 | 旧号（Halo 那台） | UIN `100047610252`（昵称 旺动香菇-昆阳喷泉） |
| 实例 | `Halo建站-AFjg` / `lhins-b0l0d8b2` | `neo-mysql-redis` / `lhins-1whwkmau` |
| 公网 | `62.234.211.200` | `101.42.105.230` |
| 规格 | 4C / 4G / 40G Ubuntu | 4C / 4G / 40G Ubuntu 24.04，北京 `rid=8` |
| 制品 | **系统镜像 Ubuntu 24.04 LTS**（已从爱马仕/Halo 应用镜像重装） | **系统镜像 Ubuntu 24.04 LTS**（`lhbp-1l4ptuvm`，`PURE_OS`）。2026-08-22 已从 OpenClaw 应用镜像重装 |
| 跑什么 | control-plane / llm-gateway / Caddy / loop 槽 | `db-mysql`（`mysql:8.4`）、`db-redis`（`redis:7-alpine`）、`new-api`（`:3000`） |
| 同机还有 | Ubuntu 24.04 + systemd + Caddy + Node。不要再装爱马仕 | 无。不要再装 OpenClaw |

控制台列表：[北京六区](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8)。  
Chrome 里若还登着旧号，**看不到**这台机。

## Cloud Agent 怎么操作（现网）

新对话先跑应用机那份引导脚本。它读同一个 `NEO_LIGHTHOUSE_SSH_KEY_B64`，写成 `~/.ssh/neo_lighthouse`，并同时写 `Host lighthouse`（应用机）和 `Host lighthouse-db`（本机）。

```bash
bash .cursor/skills/tencent-lighthouse-deploy/bootstrap-agent-access.sh

# 只报是否 set，不要 echo 值
[ -n "${NEO_LIGHTHOUSE_SSH_KEY_B64:-}" ] && echo ssh_secret=set || echo ssh_secret=missing
[ -n "${TENCENTCLOUD_LNS_SECRET_ID:-}" ] && echo lns_api=set || echo lns_api=missing

ssh -o BatchMode=yes -o ConnectTimeout=10 lighthouse-db 'hostname; whoami'
ssh lighthouse-db 'cd /home/ubuntu/db && docker compose ps'
```

| Secret | 用途 |
| --- | --- |
| `NEO_LIGHTHOUSE_SSH_KEY_B64` | SSH 私钥（和应用机同一把）。`ssh lighthouse-db` 用这个 |
| `TENCENTCLOUD_LNS_SECRET_ID` / `TENCENTCLOUD_LNS_SECRET_KEY` | **库机账号**的云 API（Lighthouse / TAT）。不是 SSH |
| 应用机那对 `TENCENTCLOUD_*`（名字里没有 `LNS`） | **应用机账号**的云 API。看不到 `neo-mysql-redis` |

`TENCENTCLOUD_LNS_*` 是云 API，不能用来 `ssh`。SSH 仍然靠 `NEO_LIGHTHOUSE_SSH_KEY_B64`。公钥必须是这把私钥对应的 `neo-cloud-agent-deploy`（TAT 追加到 `ubuntu` 的 `authorized_keys`）。只往机上塞另一把公钥（例如 `neo-cloud-agent-ee36`）对不上当前 Secret，会 `Permission denied`。

连不上时用库机账号 TAT 追加当前公钥，**不要**重启、**不要**控制台「绑定密钥」。TAT Agent 现网 Online。查实例 / 防火墙也走 `TENCENTCLOUD_LNS_*`，实例 `lhins-1whwkmau`，地域 `ap-beijing`。中途新加的 Secret 当前这轮读不到，要再开一轮。

## SSH

引导脚本写的别名（Cloud Agent / 本机都可以）：

```
Host lighthouse-db
  HostName 101.42.105.230
  User ubuntu
  IdentityFile ~/.ssh/neo_lighthouse
  IdentitiesOnly yes
```

- 用户：`ubuntu`（也有 `lighthouse` / `root`，默认用 `ubuntu`）
- Cloud Agent 现网公钥注释：`neo-cloud-agent-deploy`（与 `NEO_LIGHTHOUSE_SSH_KEY_B64` 配对）
- 机上还留着历史行：`neo-db-deploy`、`neo-cloud-agent-ee36`。本地旧钥匙 `~/.ssh/neo_lighthouse_new` 仍可用，新对话不必再配
- 首次 / 补公钥用控制台或 API **TAT**，不要「绑定密钥」（会重启）。步骤见 [reference.md](reference.md)

## 硬约束

1. **不要重启实例。**
2. **不要在控制台绑定 SSH 密钥。** 用 TAT 追加 `authorized_keys`。
3. **不要读、打印、提交** `/home/ubuntu/db/.env`。只报键名和连通性。
4. **不要再装 OpenClaw。** 盘已重装成纯 Ubuntu，没有 gateway / 20041。
5. **不要**在这台机上部署 neo-cloud-agent / 改 Caddy / 动应用机 systemd。
6. 3306 / 6379 现在对 `0.0.0.0/0` 开放，只靠密码。3000 是 New API，靠它自己的登录。不要再把明文密码写进聊天或 git。
7. 换系统镜像（`ResetInstance`）要账号微信 MFA。不要用控制台「绑定密钥」。SSH 用 TAT 写公钥。

## 现场

| 项 | 值 |
| --- | --- |
| 目录 | `/home/ubuntu/db` |
| Compose | `/home/ubuntu/db/docker-compose.yml`（仓库模板：[docker-compose.yml](docker-compose.yml)） |
| 密钥 | `/home/ubuntu/db/.env`（`chmod 600`） |
| 网络 | Docker `dbnet` |
| 数据卷 | `db_mysql_data`、`db_redis_data`、`db_new_api_data`、`db_new_api_logs` |
| 库名 / 用户 | `app` / `app`（Neo）；`newapi` / 同一 `app` 用户（New API） |
| 镜像源 | `/etc/docker/daemon.json` → `https://mirror.ccs.tencentyun.com`（Docker Hub 直连常超时） |
| 主机 ufw | inactive；轻量防火墙：22、3306、6379、3000、ICMP（20041 可删） |
| 制品 | `lhbp-1l4ptuvm` Ubuntu 24.04 LTS 系统镜像 |

`.env` 键（值留在机上）：

```
MYSQL_ROOT_PASSWORD
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD
REDIS_PASSWORD
NEW_API_SQL_DSN
NEW_API_REDIS_CONN_STRING
NEW_API_SESSION_SECRET
NEW_API_CRYPTO_SECRET
```

New API 控制台：`http://101.42.105.230:3000`（它自己的 root 登录）。Gateway 上游：`http://101.42.105.230:3000/v1`。首次拉起用 [provision-new-api.sh](provision-new-api.sh)，再 `docker compose up -d`，再 [bootstrap-new-api.sh](bootstrap-new-api.sh)（DeepSeek 渠道 + `neo-gateway` 令牌）。令牌只写在机上 `/home/ubuntu/db/.new-api-token`，root 口令只写在 `/home/ubuntu/db/.new-api-admin`，都不要回传。

把令牌接到应用机 Gateway / 对话页（不打印值）：

```
bash .cursor/skills/tencent-lighthouse-db/wire-new-api.sh
```

它会改应用机 `.neo/llm-upstream.env` 的 `DEEPSEEK_API_KEY` / `LLM_UPSTREAM_BASE_URL`，并在应用机 `.env` 写 `NEW_API_URL` / `NEW_API_CONSOLE_URL`，然后重启 `neo-llm-gateway` `neo-control-plane` `neo-admin-api`。

控制面用的 URL **在应用机** 仓库根 `.env` 里，不要在本机拼进 git：

```
DATABASE_URL=mysql://app:<MYSQL_PASSWORD>@101.42.105.230:3306/app
REDIS_URL=redis://:<REDIS_PASSWORD>@101.42.105.230:6379/0
```

改完应用机 `.env` 后：`sudo systemctl restart neo-control-plane`（只重启控制面即可）。  
`/health` 期望：`metadataStore: "mysql"`，`eventBus: "redis"`。

## 日常操作

```bash
ssh lighthouse-db 'cd /home/ubuntu/db && docker compose ps'
ssh lighthouse-db 'cd /home/ubuntu/db && docker compose logs --tail=80 mysql redis new-api'
```

重启（容器挂了才用；不要重启整机）：

```bash
ssh lighthouse-db 'cd /home/ubuntu/db && docker compose up -d'
```

健康：

```bash
ssh lighthouse-db '
  cd /home/ubuntu/db
  set -a && . ./.env && set +a
  docker exec db-mysql mysqladmin ping -h 127.0.0.1 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent && echo mysql_ok
  docker exec db-redis redis-cli -a "$REDIS_PASSWORD" ping
'
```

只报 `mysql_ok` / `PONG` / `healthy`，不要回传密码或 `docker inspect` 里的 Env。

## 看沉淀的对话（不要 dump 密码）

在库机上 sourced `.env` 再 `docker exec`，或从能连公网 3306 的机器用客户端。表结构：

| 表 | 用途 |
| --- | --- |
| `users` / `sessions` | 账号 |
| `runs` | `record` 是整份 Run JSON（`prompt`、`status`、`followUps`） |
| `events` | `body` JSON：`kind` = `user.message` / `message.delta` / `tool.*` / `run.idle` |
| `environments` / `builds` | 预热盘；现网经常是 0 行 |
| `worker_leases` | 槽租约 |

`run_live_probe` 是连通性探测残留，可忽略。

```bash
ssh lighthouse-db 'cd /home/ubuntu/db && set -a && . ./.env && set +a && docker exec -e MYSQL_PWD="$MYSQL_PASSWORD" db-mysql mysql -u"$MYSQL_USER" app -N -e "
SELECT id, JSON_UNQUOTE(JSON_EXTRACT(record,\"$.run.status\")),
       JSON_UNQUOTE(JSON_EXTRACT(record,\"$.run.prompt\"))
FROM runs;"'
```

用户原话（`events` 没有 `created_at` 列，时间在 `body` 里）：

```sql
SELECT seq,
       JSON_UNQUOTE(JSON_EXTRACT(body,'$.createdAt')),
       JSON_UNQUOTE(JSON_EXTRACT(body,'$.data.text'))
FROM events
WHERE run_id='<id>'
  AND JSON_UNQUOTE(JSON_EXTRACT(body,'$.kind'))='user.message'
ORDER BY seq;
```

助手正文要按 `seq` 拼 `message.delta` 的 `data.delta`。Redis 侧 stream 名：`neo:run:<runId>:stream`，条数应和该 run 的 `events` 行数一致。

## 排障

| 现象 | 先查 |
| --- | --- |
| 应用机 `/health` 仍是 `fs` / `memory` | 应用机根目录 `.env` 是否有 `DATABASE_URL` / `REDIS_URL`；是否重启了 `neo-control-plane` |
| `ssh lighthouse-db` Permission denied | 这轮有没有 `NEO_LIGHTHOUSE_SSH_KEY_B64`；`ubuntu` 的 `authorized_keys` 是否已有 `neo-cloud-agent-deploy`。对不上就用 `TENCENTCLOUD_LNS_*` 走 TAT 追加，不要绑密钥 |
| 连不上 3306 / 6379 | 轻量防火墙是否放行；容器 `docker compose ps` 是否 `healthy`；密码是否和 `.env` 一致 |
| `docker pull` 超时 | 确认 `registry-mirrors` 是 `https://mirror.ccs.tencentyun.com`，`systemctl restart docker` |
| 表是空的 | 控制面还没写过；探测 run 只有 `run_live_probe` |
| 想收紧端口 | 控制台防火墙把 3306/6379 改成应用机出口 IP，不要关 22；20041 可删 |

看容器日志，不要 `cat .env`：

```bash
ssh lighthouse-db 'cd /home/ubuntu/db && docker compose logs --tail=80 mysql redis new-api'
```

## 给 Cloud Agent 的注意点

- 先跑 [../tencent-lighthouse-deploy/bootstrap-agent-access.sh](../tencent-lighthouse-deploy/bootstrap-agent-access.sh)。SSH 目标是 `lighthouse-db` / `101.42.105.230`，钥匙是 `~/.ssh/neo_lighthouse`（`NEO_LIGHTHOUSE_SSH_KEY_B64`）。
- 库机云 API 用 `TENCENTCLOUD_LNS_SECRET_ID` / `TENCENTCLOUD_LNS_SECRET_KEY`。不要拿应用机那对 `TENCENTCLOUD_SECRET_*` 去查这台。
- 连不上先用 LNS 密钥走 TAT 追加当前 `neo-cloud-agent-deploy` 公钥，不要重启、不要绑密钥。
- 验收只报 `healthy` / 表行数 / `metadataStore` / `eventBus`，不报密钥。
- 改 compose 先改仓库模板，再 scp 到 `/home/ubuntu/db` 后 `docker compose up -d`。卷名别删。
