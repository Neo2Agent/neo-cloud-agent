---
name: tencent-lighthouse-db
description: Operate Docker MySQL 8.4 and Redis 7 on the new Beijing Lighthouse (101.42.105.230 / OpenClaw(龙虾)-8Dd3). Use when checking or restarting db-mysql/db-redis, reading persisted runs/events, wiring DATABASE_URL or REDIS_URL, or opening 3306/6379. Not the app host 62.234.211.200.
---

# 腾讯云轻量：MySQL / Redis 库机

这是 **新账号上的第二台轻量**，只跑 Docker 里的 MySQL + Redis。  
**不要**把它当成应用机，也 **不要**去 `62.234.211.200` 上找这两个容器。

应用机（部署 neo-cloud-agent、systemd、Caddy、VM 槽）见 [../tencent-lighthouse-deploy/SKILL.md](../tencent-lighthouse-deploy/SKILL.md)。

## 两台机

| | 应用机 | 库机（本 skill） |
| --- | --- | --- |
| 账号 | 旧号（Halo 那台） | UIN `100047610252`（昵称 旺动香菇-昆阳喷泉） |
| 实例 | `Halo建站-AFjg` / `lhins-b0l0d8b2` | `OpenClaw(龙虾)-8Dd3` / `lhins-1whwkmau` |
| 公网 | `62.234.211.200` | `101.42.105.230` |
| 规格 | 4C / 4G / 40G Ubuntu | 4C / 4G / 40G Ubuntu 24.04，北京 `rid=8` |
| 跑什么 | control-plane / llm-gateway / Caddy / loop 槽 | `db-mysql`（`mysql:8.4`）、`db-redis`（`redis:7-alpine`） |
| 同机还有 | 爱马仕已下线，不要拉起 | `openclaw-gateway` 占 **20041**，不要停 |

控制台列表：[北京六区](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8)。  
Chrome 里若还登着旧号，**看不到**这台机。

## SSH

```
Host lighthouse-db
  HostName 101.42.105.230
  User ubuntu
  IdentityFile ~/.ssh/neo_lighthouse_new
  IdentitiesOnly yes
```

- 用户：`ubuntu`（也有 `lighthouse` / `root`，默认用 `ubuntu`）
- 密钥注释：`neo-db-deploy`
- 首次装公钥用控制台 **TAT**，不要「绑定密钥」（会重启）。步骤见 [reference.md](reference.md)。

## 硬约束

1. **不要重启实例。** 同机还有 OpenClaw。
2. **不要在控制台绑定 SSH 密钥。** 用 TAT 追加 `authorized_keys`。
3. **不要读、打印、提交** `/home/ubuntu/db/.env`。只报键名和连通性。
4. **不要停 `openclaw-gateway`（`:20041`）。**
5. **不要**在这台机上部署 neo-cloud-agent / 改 Caddy / 动应用机 systemd。
6. 3306 / 6379 现在对 `0.0.0.0/0` 开放，只靠密码。不要再把明文密码写进聊天或 git。

## 现场

| 项 | 值 |
| --- | --- |
| 目录 | `/home/ubuntu/db` |
| Compose | `/home/ubuntu/db/docker-compose.yml`（仓库模板：[docker-compose.yml](docker-compose.yml)） |
| 密钥 | `/home/ubuntu/db/.env`（`chmod 600`） |
| 网络 | Docker `dbnet` |
| 数据卷 | `db_mysql_data`、`db_redis_data` |
| 库名 / 用户 | `app` / `app` |
| 镜像源 | `/etc/docker/daemon.json` → `https://mirror.ccs.tencentyun.com`（Docker Hub 直连常超时） |
| 主机 ufw | inactive；放行在轻量控制台防火墙：22、3306、6379、20041、ICMP |

`.env` 键（值留在机上）：

```
MYSQL_ROOT_PASSWORD
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD
REDIS_PASSWORD
```

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
ssh lighthouse-db 'cd /home/ubuntu/db && docker compose logs --tail=80 mysql redis'
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
| 连不上 3306 / 6379 | 轻量防火墙是否放行；容器 `docker compose ps` 是否 `healthy`；密码是否和 `.env` 一致 |
| `docker pull` 超时 | 确认 `registry-mirrors` 是 `https://mirror.ccs.tencentyun.com`，`systemctl restart docker` |
| 表是空的 | 控制面还没写过；探测 run 只有 `run_live_probe` |
| 想收紧端口 | 控制台防火墙把 3306/6379 改成应用机出口 IP，不要关 22 / 20041 |

看容器日志，不要 `cat .env`：

```bash
ssh lighthouse-db 'cd /home/ubuntu/db && docker compose logs --tail=80 mysql redis'
```

## 给 Cloud Agent 的注意点

- SSH 目标是 `lighthouse-db` / `101.42.105.230`，密钥 `~/.ssh/neo_lighthouse_new`。
- 连不上先 TAT 追加当前公钥，不要重启、不要绑密钥。
- 验收只报 `healthy` / 表行数 / `metadataStore` / `eventBus`，不报密钥。
- 改 compose 先改仓库模板，再 scp 到 `/home/ubuntu/db` 后 `docker compose up -d`。卷名别删。
