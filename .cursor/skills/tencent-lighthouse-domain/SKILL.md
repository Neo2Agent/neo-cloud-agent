---
name: tencent-lighthouse-domain
description: Bind a Tencent Cloud / DNSPod domain to the Beijing Lighthouse app host (neorun.cloud → 62.234.211.200). Use when buying a domain, adding A records, scanning WeChat to open the console, checking DNS, or enabling HTTPS. Not the MySQL/Redis host 101.42.105.230.
---

# 腾讯云轻量：域名绑定

把已买的域名解析到应用机公网 IP，让 Caddy 用主机名对外提供对话页。  
公网入口是 `https://neorun.cloud`。HTTPS 怎么开、要不要花钱，见 [docs/production-domain.md](../../../docs/production-domain.md)。

应用机部署见 [../tencent-lighthouse-deploy/SKILL.md](../tencent-lighthouse-deploy/SKILL.md)。库机见 [../tencent-lighthouse-db/SKILL.md](../tencent-lighthouse-db/SKILL.md)。**不要混。**

## 现网

| 项 | 值 |
| --- | --- |
| 域名账号 | 周栋 / UIN `100046045274`（买域名、管 DNSPod 的号） |
| 域名 | `neorun.cloud`（2026-08-25 新注 1 年，不续费也按此流程绑） |
| NS | `scallop.dnspod.net` / `mooncake.dnspod.net` |
| 应用机 | `Halo建站-AFjg` / `lhins-b0l0d8b2` / `62.234.211.200` / 北京 `rid=8` |
| 解析 | `@`、`www` 的 A 记录 → `62.234.211.200`，TTL 600。若有 `admin` A 记录，只 308 到 `/admin/`，不要当第三个站点 |
| 入口 | `https://neorun.cloud/` 对话，`https://neorun.cloud/admin/` 管理台。域名 HTTP 308 到 HTTPS。裸 IP `http://62.234.211.200/` 只做运维兜底。同一域名路径，不要 `/a` `/b`，也不要再买子域 |
| HTTPS | Caddy + Let's Encrypt，域名强制跳 HTTPS 并下 HSTS。轻量控制台「设置 HTTPS」不要点 |
| 库机 | **不要**绑到 `101.42.105.230` |

还有一个库机账号（UIN `100047610252`）。Chrome 若登着那个号，**看不到**这台应用机，也看不到 `neorun.cloud`。扫码前确认是买域名的号。

## 硬约束

1. **不要重启、重装、绑定密钥。** 绑域名只动 DNSPod / 轻量「域名解析」。
2. **不要**用轻量控制台一键 HTTPS 去改 Ubuntu 系统镜像上的 Caddy。一键 HTTPS 只支持 WordPress / LAMP 等应用镜像，会走 TAT 写 Nginx，和现网栈冲突。
3. **不要**把域名指到库机，也不要在库机装 Caddy。
4. 未登录时打开控制台会拦微信扫码。**等用户扫完再继续，不要猜密码。**
5. 域名是即时商品，注册成功不退款。溢价词不走活动价。

## 登录控制台

1. 打开 [轻量北京六区](https://console.cloud.tencent.com/lighthouse/instance/index?rid=8) 或 [域名解析](https://console.cloud.tencent.com/cns)。
2. 未登录则切到 **微信登录**，把二维码给用户扫。码大约 1 分钟过期，过期就刷新。
3. 登录后看右上角账号。应是 **周栋 / 100046045274**，列表里有 `Halo建站-AFjg` 和公网 `62.234.211.200`。
4. 若看到的是库机账号或没有这台实例：停下来换号，不要新建服务器。

## 绑定步骤（已买域名）

解析和轻量「添加域名解析」是同一套 DNSPod 记录，做一次即可。两边都做也只是同一条 A 记录。

### 1. DNSPod 权威解析

打开 [记录管理](https://console.cloud.tencent.com/cns/detail/neorun.cloud/records)（换域名就改路径里的名字）。

| 主机记录 | 类型 | 线路 | 记录值 | TTL |
| --- | --- | --- | --- | --- |
| `@` | A | 默认 | `62.234.211.200` | 600 |
| `www` | A | 默认 | `62.234.211.200` | 600 |

已有记录指向别的 IP 就改，不要再加一条默认线路的 A。不要删 NS。

### 2. 轻量「域名解析」

实例详情 → **域名解析** → 添加 `neorun.cloud`。状态应为 **正常**，类型 A。  
这一步只是把同一条解析挂到实例上，方便以后看；**不会改 Caddy**。

### 3. 防火墙

应用机防火墙确认：

| 端口 | 用途 |
| --- | --- |
| 80 | 现网对话页（必须开） |
| 443 | HTTPS（Caddy 已听，Let's Encrypt） |
| 22 | SSH，不要关 |
| 3306 / 6379 | **不要**在应用机放行；库在另一台 |

主机 `ufw` 是 inactive。改端口只动轻量防火墙，不要开整机重启。

### 4. 主机侧

现网 Caddy 用 [units/Caddyfile.https](units/Caddyfile.https)。域名走自动 HTTPS，HTTP 308 到 HTTPS，并下 HSTS。裸 IP 仍听 `:80`。`/` → `:8080`，`/admin/` → `:8090`（`handle_path` 去掉前缀）。`flush_interval -1`。不要点控制台一键 HTTPS。不要开 8090 公网。

改证书配置：备份 `/etc/caddy/Caddyfile`，覆盖模板，`sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`，再 `sudo systemctl reload caddy`。看 `journalctl -u caddy` 里是否有 `certificate obtained successfully`。只听 `:80` 的旧模板在 [../tencent-lighthouse-deploy/units/Caddyfile](../tencent-lighthouse-deploy/units/Caddyfile)。

## 验收

本机解析有时打不到国内 DNSPod，用 `1.1.1.1` 或 `--resolve`：

```bash
dig +short A neorun.cloud @1.1.1.1
dig +short A www.neorun.cloud @1.1.1.1
# 期望两行都是 62.234.211.200

curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" --resolve neorun.cloud:80:62.234.211.200 http://neorun.cloud/
curl -sS -o /dev/null -w "%{http_code}\n" --resolve neorun.cloud:443:62.234.211.200 https://neorun.cloud/
curl -sS --resolve neorun.cloud:443:62.234.211.200 https://neorun.cloud/ | grep -E "<title>|Neo Cloud Agent"
curl -sS --resolve neorun.cloud:443:62.234.211.200 https://neorun.cloud/admin/ | grep -E "<title>|Neo 管理台"
```

期望：域名 HTTP `308` 到 `https://neorun.cloud/`；HTTPS 对话 `200`，标题 `Neo Cloud Agent`；管理台 `/admin/` 标题 `Neo 管理台`。登录仍是手输 `admin` / `123456`，不要把密码写进新文档以外的聊天。

## 排障

| 现象 | 先查 |
| --- | --- |
| 控制台没有这台机 / 没有这个域名 | 登错号。换回 `100046045274` |
| 解析状态不是「正常」 | DNSPod 记录值、线路、域名是否还在该账号 |
| `dig` 无 A，但控制台有记录 | 等 TTL；或权威 NS 被环境墙。改查 `@1.1.1.1` |
| 域名 200 但标题是 Caddy 欢迎页 | 应用机 `/etc/caddy/Caddyfile` 没反代 `:8080` |
| 一键 HTTPS 失败 / 站点变 Nginx | 镜像不是 WordPress 系。停，用 Caddy 模板，不要继续点 |

## 给 Cloud Agent 的注意点

- 有 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` 时优先 `tccli dnspod`（先跑 deploy skill 的 `bootstrap-agent-access.sh`），不要一上来就扫码。
- 未登录且没有云 API 密钥时先给微信码，扫完再改解析。
- 只动 DNS、Caddy 模板和文档；不要重启实例、不要 TAT 乱改 Caddy。
- 验收只报解析 IP、HTTP/HTTPS 状态、页面标题，不报账号里的证书私钥或 `.env`。
- HTTPS 用 Caddy + Let's Encrypt，**不花钱**。现网已经开着并强制跳转。不要买腾讯云付费证书，不要点轻量一键 HTTPS。细节在 `docs/production-domain.md`。
